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
	const requestBody = JSON.stringify(payload);
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
