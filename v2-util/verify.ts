/**
 * Verify a Linear webhook signature.
 *
 * Linear signs each webhook with HMAC-SHA256 of the raw request body using the
 * signing secret shown when the webhook is created. The hex digest is sent in
 * the `linear-signature` header.
 *
 * Uses Web Crypto (`globalThis.crypto.subtle`), which is available on Node 20+
 * and inside the Vercel runtime without any extra polyfills.
 *
 * https://linear.app/developers/webhooks#securing-webhooks
 */

function hexToBytes(hex: string): Uint8Array | null {
	if (hex.length === 0 || hex.length % 2 !== 0) {
		return null;
	}
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		if (Number.isNaN(byte)) {
			return null;
		}
		bytes[i] = byte;
	}
	return bytes;
}

export async function verifyLinearSignature(
	secret: string,
	headerSignature: string | undefined | null,
	rawBody: ArrayBuffer | Uint8Array,
): Promise<boolean> {
	if (typeof headerSignature !== 'string') {
		return false;
	}

	const sigBytes = hexToBytes(headerSignature);
	if (!sigBytes) {
		return false;
	}

	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{name: 'HMAC', hash: 'SHA-256'},
		false,
		['verify'],
	);

	// `.buffer.slice()` materialises a plain ArrayBuffer, sidestepping the
	// SharedArrayBuffer mismatch in newer TS lib types. Honor byteOffset +
	// byteLength so Buffer views (Uint8Array subclasses that share a pool
	// of bytes with unrelated allocations) only hash their own bytes.
	const sig: ArrayBuffer = sigBytes.buffer.slice(
		sigBytes.byteOffset,
		sigBytes.byteOffset + sigBytes.byteLength,
	) as ArrayBuffer;
	const body: ArrayBuffer =
		rawBody instanceof Uint8Array
			? (rawBody.buffer.slice(
					rawBody.byteOffset,
					rawBody.byteOffset + rawBody.byteLength,
				) as ArrayBuffer)
			: rawBody;

	return crypto.subtle.verify('HMAC', key, sig, body);
}

export const TIMESTAMP_TOLERANCE_MS = 60 * 1000;
