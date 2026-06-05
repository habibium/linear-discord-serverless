/**
 * Minimal Discord embed types — we send the embed JSON directly to the
 * webhook endpoint rather than pulling in the full discord.js client, which
 * adds ~20MB of cold-start weight that we don't need for a webhook fan-out.
 *
 * https://discord.com/developers/docs/resources/channel#embed-object
 */

export interface DiscordEmbedFooter {
	text: string;
	icon_url?: string;
}

export interface DiscordEmbedAuthor {
	name: string;
	url?: string;
	icon_url?: string;
}

export interface DiscordEmbedField {
	name: string;
	value: string;
	inline?: boolean;
}

export interface DiscordEmbed {
	title?: string;
	description?: string;
	url?: string;
	timestamp?: string;
	color?: number;
	footer?: DiscordEmbedFooter;
	author?: DiscordEmbedAuthor;
	fields?: DiscordEmbedField[];
}

export interface DiscordWebhookPayload {
	embeds: DiscordEmbed[];
	username?: string;
	avatar_url?: string;
}

export function hexToInt(hex: string): number {
	return parseInt(hex.replace(/^#/, ''), 16);
}

// https://discord.com/developers/docs/resources/channel#embed-object-embed-limits
export const DISCORD_LIMITS = {
	title: 256,
	description: 4096,
	fieldName: 256,
	fieldValue: 1024,
	fieldsPerEmbed: 25,
	authorName: 256,
	footerText: 2048,
	totalEmbedChars: 6000,
} as const;

const ELLIPSIS = '…';

function truncate(s: string | undefined, max: number): string | undefined {
	if (s == null) return s;
	if (s.length <= max) return s;
	return s.slice(0, max - ELLIPSIS.length) + ELLIPSIS;
}

/**
 * Apply Discord's per-field length limits to every embed in the payload so a
 * legitimately large Linear issue / project description doesn't blow up the
 * webhook with a 400. Cuts strings to the documented maxima, drops fields
 * beyond the 25-per-embed limit, and trims a final pass against the
 * 6000-char per-embed total.
 */
export function sanitizeEmbed(embed: DiscordEmbed): DiscordEmbed {
	const out: DiscordEmbed = {
		...embed,
		title: truncate(embed.title, DISCORD_LIMITS.title),
		description: truncate(embed.description, DISCORD_LIMITS.description),
	};

	if (embed.author) {
		out.author = {
			...embed.author,
			name:
				truncate(embed.author.name, DISCORD_LIMITS.authorName) ??
				embed.author.name,
		};
	}

	if (embed.footer) {
		out.footer = {
			...embed.footer,
			text:
				truncate(embed.footer.text, DISCORD_LIMITS.footerText) ??
				embed.footer.text,
		};
	}

	if (embed.fields && embed.fields.length > 0) {
		out.fields = embed.fields
			.slice(0, DISCORD_LIMITS.fieldsPerEmbed)
			.map(f => ({
				...f,
				name: truncate(f.name, DISCORD_LIMITS.fieldName) ?? f.name,
				value: truncate(f.value, DISCORD_LIMITS.fieldValue) ?? f.value,
			}));
	}

	// Final guard against the 6000-char per-embed total. Trim description
	// first since it's the largest free-form field.
	const totalLength = (e: DiscordEmbed): number =>
		(e.title?.length ?? 0) +
		(e.description?.length ?? 0) +
		(e.author?.name?.length ?? 0) +
		(e.footer?.text?.length ?? 0) +
		(e.fields ?? []).reduce(
			(acc, f) => acc + f.name.length + f.value.length,
			0,
		);

	if (totalLength(out) > DISCORD_LIMITS.totalEmbedChars && out.description) {
		const overflow = totalLength(out) - DISCORD_LIMITS.totalEmbedChars;
		const targetDescLen = Math.max(0, out.description.length - overflow - 1);
		out.description = truncate(out.description, targetDescLen);
	}

	return out;
}

export class DiscordWebhookError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: string,
	) {
		super(`Discord webhook responded ${status}: ${body}`);
	}
}

export async function sendDiscordWebhook(
	url: string,
	payload: DiscordWebhookPayload,
): Promise<void> {
	const sanitized: DiscordWebhookPayload = {
		...payload,
		embeds: payload.embeds.map(sanitizeEmbed),
	};

	const requestBody = JSON.stringify(sanitized);
	const res = await fetch(url, {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		body: requestBody,
	});

	if (res.status >= 400) {
		const body = await res.text().catch(() => '<unreadable>');
		console.error('Discord rejected payload:', requestBody);
		console.error('Discord response body:', body);
		throw new DiscordWebhookError(res.status, body);
	}
}
