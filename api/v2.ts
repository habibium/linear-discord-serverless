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
// IssueLabel, …). Anything outside this set 200-skips so Linear
// stops retrying webhooks that the handler intentionally ignores.
const RENDERED_TYPES = new Set([
	'Comment',
	'Issue',
	'Cycle',
	'Reaction',
	'Project',
]);

const PRIORITY_LABELS = [
	'No priority',
	'Urgent',
	'High',
	'Medium',
	'Low',
] as const;

function humanFieldName(key: string): string {
	return key
		.replace(/Id$/, '')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/^./, c => c.toUpperCase());
}

const DESCRIPTION_LINE_CAP = 5;

/**
 * Cap free-form description fields to a few lines so a long Linear issue or
 * project doesn't take up the whole Discord channel. Drops trailing markdown
 * rules / blank-only lines and appends an ellipsis when there's more.
 */
function summarizeDescription(text: string): string {
	const lines = text.split('\n');
	const head = lines.slice(0, DESCRIPTION_LINE_CAP);

	while (
		head.length > 0 &&
		/^(\s*|-{3,}|\*{3,}|_{3,})$/.test(head[head.length - 1] ?? '')
	) {
		head.pop();
	}

	const trimmed = head.join('\n');
	return lines.length > head.length ? `${trimmed}\n…` : trimmed;
}

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

				const verb =
					body.action === 'create'
						? 'Comment on'
						: body.action === 'update'
							? 'Comment edited on'
							: 'Comment removed from';
				const issueKey = issueLookup?.identifier;
				embed.title = issueKey
					? `${verb} ${body.data.issue.title} [${issueKey}]`
					: `${verb} ${body.data.issue.title}`;
				embed.description = body.data.body;
				if (comment?.url) {
					embed.url = comment.url;
				} else if (issueLookup?.url) {
					embed.url = issueLookup.url;
				}
				if (body.action === 'remove') {
					embed.color = hexToInt('#d95858');
				}
				embed.author = {
					name: author.name,
					icon_url: author.avatarUrl ?? undefined,
				};
				break;
			}

			case 'Issue': {
				const [creator, assignee, projectLookup] = await Promise.all([
					client.user(body.data.creatorId).catch(() => null),
					body.data.assigneeId
						? client.user(body.data.assigneeId).catch(() => null)
						: Promise.resolve(null),
					body.data.projectId
						? client.project(body.data.projectId).catch(() => null)
						: Promise.resolve(null),
				]);

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

				if (typeof body.data.priority === 'number') {
					const label =
						body.data.priorityLabel ??
						PRIORITY_LABELS[body.data.priority] ??
						'No priority';
					embed.fields.push({name: 'Priority', value: label, inline: true});
				}

				if (body.data.dueDate) {
					embed.fields.push({
						name: 'Due',
						value: body.data.dueDate,
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

				if (projectLookup) {
					embed.fields.push({
						name: 'Project',
						value: `[${projectLookup.name}](${projectLookup.url})`,
						inline: true,
					});
				}

				// Labels on their own row so long label lists don't squish other
				// fields. `inline: false` forces a full-width row.
				if (body.data.labels && body.data.labels.length > 0) {
					embed.fields.push({
						name: 'Labels',
						value: body.data.labels
							.map((label: Label) => label.name)
							.join(', '),
						inline: false,
					});
				}

				if (body.action === 'update' && body.updatedFrom) {
					const changed = Object.keys(body.updatedFrom).filter(
						k => k !== 'updatedAt' && k !== 'sortOrder',
					);
					if (changed.length > 0) {
						embed.fields.push({
							name: 'Changed',
							value: changed.map(humanFieldName).join(', '),
						});
					}
				}

				if (body.action === 'remove') {
					embed.color = hexToInt('#d95858');
				}

				if (body.data.description?.length) {
					embed.description = summarizeDescription(body.data.description);
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

			case 'Project': {
				const verb =
					body.action === 'create'
						? 'Project created'
						: body.action === 'remove'
							? 'Project removed'
							: 'Project updated';
				embed.title = `${verb}: ${body.data.name}`;
				embed.url = body.url ?? body.data.url ?? undefined;

				if (body.data.description?.length) {
					embed.description = summarizeDescription(body.data.description);
				}

				embed.fields = [];

				const statusName = body.data.status?.name ?? body.data.state;
				if (statusName) {
					embed.fields.push({
						name: 'Status',
						value: statusName,
						inline: true,
					});
				}

				if (body.data.status?.color) {
					embed.color = hexToInt(body.data.status.color);
				} else if (body.data.color) {
					embed.color = hexToInt(body.data.color);
				}

				if (body.action === 'remove') {
					embed.color = hexToInt('#d95858');
				}

				if (body.action === 'update' && body.updatedFrom) {
					const changed = Object.keys(body.updatedFrom).filter(
						k => k !== 'updatedAt' && k !== 'sortOrder',
					);
					if (changed.length > 0) {
						embed.fields.push({
							name: 'Changed',
							value: changed.map(humanFieldName).join(', '),
						});
					}
				}

				break;
			}
		}

		const webhook = `https://discord.com/api/webhooks/${webhookId}/${webhookToken}`;

		await sendDiscordWebhook(webhook, {embeds: [embed], avatar_url: avatar});
	},
});
