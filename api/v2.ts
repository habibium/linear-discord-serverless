import {LinearClient} from '@linear/sdk';
import type {VercelRequest} from '@vercel/node';
import {z} from 'zod';
import {api, HttpError} from '../v2-util/api';
import {DiscordEmbed, hexToInt, sendDiscordWebhook} from '../v2-util/discord';
import type {Label} from '../v2-util/issue';
import {parseProjectRoutes, resolveWebhookUrl} from '../v2-util/routes';
import {bodySchema} from '../v2-util/schema';
import {getId} from '../v2-util/util';
import {TIMESTAMP_TOLERANCE_MS, verifyLinearSignature} from '../v2-util/verify';

// Disable Vercel's body parser so we can hash the exact bytes Linear signed.
export const config = {
	api: {bodyParser: false},
};

const querySchema = z.object({
	api: z.string(),
	token: z.string(),
	id: z.string(),
});

// Linear ships many event types we don't render (Customer, Document,
// IssueAttachment, Initiative, ProjectUpdate, IssueSLA, OAuthApp, …).
// Anything outside this set 200-skips so Linear stops retrying.
const RENDERED_TYPES = new Set(['Comment', 'Issue', 'Cycle', 'Reaction']);

const LINEAR_PURPLE = hexToInt('#5864d9');
const avatar = 'https://i.imgur.com/SICZmw8.png';
const footer = 'Linear App';

async function readRawBody(req: VercelRequest): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks);
}

export default api({
	async POST(req) {
		const secret = process.env.LINEAR_WEBHOOK_SECRET;
		if (!secret) {
			throw new HttpError(
				500,
				'Server is missing the LINEAR_WEBHOOK_SECRET environment variable.',
			);
		}

		const rawHeader = req.headers['linear-signature'];
		const signatureHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
		const rawBody = await readRawBody(req);

		const ok = await verifyLinearSignature(secret, signatureHeader, rawBody);
		if (!ok) {
			throw new HttpError(401, 'Invalid Linear webhook signature.');
		}

		const parsedRaw = JSON.parse(rawBody.toString('utf8')) as {
			type?: unknown;
			webhookTimestamp?: number;
		};

		if (
			typeof parsedRaw.webhookTimestamp === 'number' &&
			Math.abs(Date.now() - parsedRaw.webhookTimestamp) > TIMESTAMP_TOLERANCE_MS
		) {
			throw new HttpError(
				401,
				'Webhook timestamp is outside the tolerance window.',
			);
		}

		const rawType =
			typeof parsedRaw.type === 'string' ? parsedRaw.type : '<missing>';

		if (!RENDERED_TYPES.has(rawType)) {
			console.log(`Skipping unsupported event type: ${rawType}`);
			return {skipped: rawType};
		}

		const parseResult = bodySchema.safeParse(parsedRaw);
		if (!parseResult.success) {
			console.error(
				`Schema parse failed for type=${rawType}:`,
				JSON.stringify(parseResult.error.issues, null, 2),
			);
			console.error('Raw payload:', JSON.stringify(parsedRaw));
			throw new HttpError(
				400,
				`Webhook body did not match the expected schema for type ${rawType}.`,
			);
		}
		const body = parseResult.data;

		const {
			token: webhookToken,
			id: webhookId,
			api: apiKey,
		} = querySchema.parse(req.query);

		const client = new LinearClient({
			apiKey,
			headers: {'User-Agent': 'github.com/alii/linear-discord-serverless'},
		});

		const embed: DiscordEmbed = {
			color: LINEAR_PURPLE,
			footer: {text: footer, icon_url: avatar},
			timestamp: body.data.updatedAt.toISOString(),
		};

		switch (body.type) {
			case 'Comment': {
				const author = await client.user(body.data.userId);

				// Linear's Comment payload doesn't carry the issue's `identifier`
				// or `url`, so look it up. The lookup can fail for `remove` events
				// that cascade from an issue deletion — fall back to the bracket-
				// less title in that case.
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
				const assignee = body.data.assigneeId
					? await client.user(body.data.assigneeId)
					: null;

				// `actor` identifies the user who performed this specific action
				// (e.g. an editor on an update), distinct from the issue's
				// original creator. Fall back to a creator lookup for older
				// payloads without `actor`.
				const performer = body.actor
					? {
							name: body.actor.name,
							avatarUrl: body.actor.avatarUrl,
							url: body.actor.url,
						}
					: await client.user(body.data.creatorId);

				embed.author = {
					name: `${body.action}d by ${performer.name}`,
					icon_url: performer.avatarUrl ?? undefined,
					url: performer.url,
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
		}

		const defaultWebhook = `https://discord.com/api/webhooks/${webhookId}/${webhookToken}`;
		const routes = parseProjectRoutes(process.env.LDS_PROJECT_ROUTES);
		const projectId =
			body.type === 'Issue' ? (body.data.projectId ?? undefined) : undefined;
		const targetUrl = resolveWebhookUrl(routes, projectId, defaultWebhook);

		await sendDiscordWebhook(targetUrl, {embeds: [embed], avatar_url: avatar});
	},
});
