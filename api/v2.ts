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

		const body = req.body as z.infer<typeof bodySchema>;

		const embed: DiscordEmbed = {
			color: LINEAR_PURPLE,
			footer: {text: footer, icon_url: avatar},
			timestamp: body.data.updatedAt.toISOString(),
		};

		switch (body.type) {
			case 'Comment': {
				const author = await client.user(body.data.userId);
				const comment = await client.comment({id: body.data.id});

				embed.title = `Comment on ${body.data.issue.title} [${getId(body.url)}]`;
				embed.description = body.data.body;
				embed.url = comment.url;
				embed.author = {
					name: author.name,
					icon_url: author.avatarUrl ?? undefined,
				};
				break;
			}

			case 'Issue': {
				const creator = await client.user(body.data.creatorId);
				const assignee = body.data.assigneeId
					? await client.user(body.data.assigneeId)
					: null;

				embed.author = {
					name: `${body.action}d by ${creator.name}`,
					icon_url: creator.avatarUrl ?? undefined,
					url: creator.url,
				};
				embed.title = `[${getId(body.url)}] ${body.data.title}`;
				embed.url = body.url;
				embed.color = hexToInt(body.data.state.color);
				embed.fields = [
					{name: 'State', value: body.data.state.name, inline: true},
				];

				if (body.data.labels) {
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
				const comment = await client.comment({id: body.data.commentId});

				embed.title = `Reaction ${body.action}d by ${body.data.user.name}.`;
				embed.url = comment.url;
				embed.fields = [
					{
						name: 'Comment',
						value: `[Click Here](${comment.url})`,
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
					cycle.issueCountHistory[cycle.issueCountHistory.length - 1];

				const completed =
					cycle.completedIssueCountHistory[
						cycle.completedIssueCountHistory.length - 1
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

			default: {
				throw new HttpError(
					400,
					`The resource type ${body.type} is not supported yet!`,
				);
			}
		}

		const webhook = `https://discord.com/api/webhooks/${webhookId}/${webhookToken}`;

		await sendDiscordWebhook(webhook, {embeds: [embed], avatar_url: avatar});
	},
});
