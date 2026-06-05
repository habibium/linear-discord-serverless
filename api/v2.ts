import {LinearClient} from '@linear/sdk';
import {z} from 'zod';
import {bodySchema} from '../v2-util/schema';
import {api, HttpError} from '../v2-util/api';
import {DiscordEmbed, hexToInt, sendDiscordWebhook} from '../v2-util/discord';
import type {Label} from '../v2-util/issue';
import {getId} from '../v2-util/util';

const querySchema = z.object({
	api: z.string(),
	token: z.string(),
	id: z.string(),
});

const LINEAR_PURPLE = hexToInt('#5864d9');

const avatar = 'https://i.imgur.com/SICZmw8.png';
const footer = 'Linear App';

// Linear's documented webhook source IPs.
// https://linear.app/developers/webhooks
const LINEAR_IPS = new Set([
	'35.231.147.226',
	'35.243.134.228',
	'34.140.253.14',
	'34.38.87.206',
	'34.134.222.122',
	'35.222.25.142',
]);

// Linear ships many event types we don't render (Customer, Document,
// IssueAttachment, Initiative, ProjectUpdate, IssueSLA, OAuthApp,
// IssueLabel, Project, …). Anything outside this set 200-skips so Linear
// stops retrying webhooks that the handler intentionally ignores.
const RENDERED_TYPES = new Set(['Comment', 'Issue', 'Cycle', 'Reaction']);

export default api({
	async POST(req) {
		const forwardedFor = req.headers['x-vercel-forwarded-for'];
		const sourceIp = Array.isArray(forwardedFor)
			? forwardedFor[0]
			: forwardedFor;

		if (
			process.env.NODE_ENV !== 'development' &&
			(!sourceIp || !LINEAR_IPS.has(sourceIp))
		) {
			throw new HttpError(400, 'Request did not originate from Linear.');
		}

		const {
			token: webhookToken,
			id: webhookId,
			api: apiKey,
		} = querySchema.parse(req.query);

		const client = new LinearClient({
			apiKey,
			headers: {'User-Agent': 'github.com/alii/linear-discord-serverless'},
		});

		const rawType =
			typeof (req.body as {type?: unknown})?.type === 'string'
				? (req.body as {type: string}).type
				: '<missing>';

		if (!RENDERED_TYPES.has(rawType)) {
			console.log(`Skipping unsupported event type: ${rawType}`);
			return {skipped: rawType};
		}

		const parseResult = bodySchema.safeParse(req.body);
		if (!parseResult.success) {
			console.error(
				`Schema parse failed for type=${rawType}:`,
				JSON.stringify(parseResult.error.issues, null, 2),
			);
			console.error('Raw payload:', JSON.stringify(req.body));
			throw new HttpError(
				400,
				`Webhook body did not match the expected schema for type ${rawType}.`,
			);
		}
		const body = parseResult.data;

		const embed: DiscordEmbed = {
			color: LINEAR_PURPLE,
			footer: {text: footer, icon_url: avatar},
			timestamp: body.data.updatedAt.toISOString(),
		};

		switch (body.type) {
			case 'Comment': {
				const author = await client.user(body.data.userId);

				// Linear's Comment payload doesn't carry the issue's identifier
				// or url, so look it up. The lookup can fail when a comment is
				// being removed because its parent issue is being deleted —
				// fall back to the bracket-less title in that case.
				const [comment, issueLookup] = await Promise.all([
					client.comment({id: body.data.id}).catch(() => null),
					client.issue(body.data.issueId).catch(() => null),
				]);

				const issueKey = issueLookup?.identifier;
				embed.title = issueKey
					? `Comment on ${body.data.issue.title} [${issueKey}]`
					: `Comment on ${body.data.issue.title}`;
				embed.description = body.data.body;
				if (comment?.url) {
					embed.url = comment.url;
				} else if (issueLookup?.url) {
					embed.url = issueLookup.url;
				}
				embed.author = {
					name: author.name,
					icon_url: author.avatarUrl ?? undefined,
				};
				break;
			}

			case 'Issue': {
				const creator = await client
					.user(body.data.creatorId)
					.catch(() => null);
				const assignee = body.data.assigneeId
					? await client.user(body.data.assigneeId).catch(() => null)
					: null;

				embed.author = {
					name: `${body.action}d by ${creator?.name ?? 'someone'}`,
					icon_url: creator?.avatarUrl ?? undefined,
					url: creator?.url,
				};
				const issueUrl = body.url ?? body.data.url ?? undefined;
				const issueKey =
					body.data.identifier ?? (issueUrl ? getId(issueUrl) : '?');
				embed.title = `[${issueKey}] ${body.data.title}`;
				embed.url = issueUrl;
				embed.color = hexToInt(body.data.state.color);
				embed.fields = [
					{name: 'State', value: body.data.state.name, inline: true},
				];

				if (body.data.labels && body.data.labels.length > 0) {
					embed.fields.push({
						name: 'Labels',
						value: body.data.labels
							.map((label: Label) => label.name)
							.join(', '),
						inline: true,
					});
				}

				if (assignee) {
					embed.fields.push({
						name: 'Assigned to',
						value: `[${assignee.name}](${assignee.url})`,
						inline: true,
					});
				}

				if (body.data.description?.length) {
					embed.description = body.data.description;
				}
				break;
			}

			case 'Reaction': {
				// Reactions now attach to either a comment (legacy) or an issue
				// (current). Render whichever target the payload carries.
				const targetField = body.data.commentId
					? {
							name: 'Comment',
							url: (
								await client
									.comment({id: body.data.commentId})
									.catch(() => null)
							)?.url,
						}
					: body.data.issue
						? {
								name: `Issue ${body.data.issue.identifier ?? ''}`.trim(),
								url: body.data.issue.url ?? undefined,
							}
						: null;

				embed.title = `Reaction ${body.action}d by ${body.data.user.name}.`;
				if (targetField?.url) {
					embed.url = targetField.url;
				}
				embed.fields = [
					{
						name: targetField?.name ?? 'Target',
						value: targetField?.url
							? `[Click Here](${targetField.url})`
							: '(unavailable)',
						inline: true,
					},
					{name: 'Emoji', value: `:${body.data.emoji}:`, inline: true},
				];
				break;
			}

			case 'Cycle': {
				const team = await client.team(body.data.teamId);
				const cycle = await client.cycle(body.data.id);

				const issues =
					(cycle.issueCountHistory ?? [])[
						(cycle.issueCountHistory ?? []).length - 1
					];
				const completed =
					(cycle.completedIssueCountHistory ?? [])[
						(cycle.completedIssueCountHistory ?? []).length - 1
					];

				embed.title = `Cycle ${body.action}d for team ${team.name}`;
				embed.fields = [
					{
						name: 'Starts',
						value: body.data.startsAt.format('YYYY-MM-DD'),
						inline: true,
					},
					{
						name: 'Ends',
						value: body.data.endsAt.format('YYYY-MM-DD'),
						inline: true,
					},
					{name: 'Issues', value: String(issues ?? 0)},
					{
						name: 'Completed Issues',
						value: String(completed ?? 0),
						inline: true,
					},
				];

				if (team.description) {
					embed.description = team.description;
				}
				break;
			}
		}

		const webhook = `https://discord.com/api/webhooks/${webhookId}/${webhookToken}`;

		await sendDiscordWebhook(webhook, {embeds: [embed], avatar_url: avatar});
	},
});
