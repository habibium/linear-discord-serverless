import crypto from 'crypto';

/**
 * Verify a Linear webhook signature.
 *
 * Linear signs each webhook with the HMAC-SHA256 of the raw request body using
 * the signing secret shown when the webhook is created. The hex digest is sent
 * in the `linear-signature` header.
 *
 * See: https://linear.app/developers/webhooks#securing-webhooks
 */
export function verifyLinearSignature(
	secret: string,
	headerSignature: string | undefined,
	rawBody: Buffer,
): boolean {
	if (typeof headerSignature !== 'string' || headerSignature.length === 0) {
		return false;
	}

	let provided: Buffer;
	try {
		provided = Buffer.from(headerSignature, 'hex');
	} catch {
		return false;
	}

	const computed = crypto
		.createHmac('sha256', secret)
		.update(rawBody)
		.digest();

	if (provided.length !== computed.length) {
		return false;
	}

	return crypto.timingSafeEqual(provided, computed);
}
