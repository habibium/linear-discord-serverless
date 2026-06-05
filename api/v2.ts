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
	// e.g. priorityLabel -> Priority Label; updatedAt -> Updated At
	return key
		.replace(/Id$/, '')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/^./, c => c.toUpperCase());
}

const DESCRIPTION_LINE_CAP = 5;

/**
 * Cap free-form description fields to a few lines so a long Linear issue or
 * project doesn't take up the whole Discord channel. Drops any trailing
 * markdown horizontal rules / blank-only lines and appends an ellipsis when
 * the original was longer.
 */
function summarizeDescription(text: string): string {
	const lines = text.split('\n');
	const head = lines.slice(0, DESCRIPTION_LINE_CAP);

	// Strip trailing markdown rules / blank lines so the cut-off looks clean.
	while (
		head.length > 0 &&
		/^(\s*|-{3,}|\*{3,}|_{3,})$/.test(head[head.length - 1] ?? '')
	) {
		head.pop();
	}

	const trimmed = head.join('\n');
	return lines.length > head.length ? `${trimmed}\n…` : trimmed;
}

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
				const [assignee, projectLookup] = await Promise.all([
					body.data.assigneeId
						? client.user(body.data.assigneeId).catch(() => null)
						: Promise.resolve(null),
					body.data.projectId
						? client.project(body.data.projectId).catch(() => null)
						: Promise.resolve(null),
				]);

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
					: await client.user(body.data.creatorId).catch(() => null);

				embed.author = {
					name: `${body.action}d by ${performer?.name ?? 'someone'}`,
					icon_url: performer?.avatarUrl ?? undefined,
					url: performer?.url,
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

		const defaultWebhook = `https://discord.com/api/webhooks/${webhookId}/${webhookToken}`;
		const routes = parseProjectRoutes(process.env.LDS_PROJECT_ROUTES);
		const projectId =
			body.type === 'Issue' ? (body.data.projectId ?? undefined) : undefined;
		const targetUrl = resolveWebhookUrl(routes, projectId, defaultWebhook);

		await sendDiscordWebhook(targetUrl, {embeds: [embed], avatar_url: avatar});
	},
});
