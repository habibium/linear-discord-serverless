import type {VercelRequest, VercelResponse} from '@vercel/node';

export class HttpError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
	}
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
type Handler = (
	req: VercelRequest,
	res: VercelResponse,
) => Promise<unknown> | unknown;

export function api(handlers: Partial<Record<Method, Handler>>) {
	return async function handler(req: VercelRequest, res: VercelResponse) {
		const method = (req.method ?? 'GET').toUpperCase() as Method;
		const fn = handlers[method];

		if (!fn) {
			res.setHeader('Allow', Object.keys(handlers).join(', '));
			res.status(405).json({
				success: false,
				data: null,
				message: `Method ${method} not allowed`,
			});
			return;
		}

		try {
			const result = await fn(req, res);
			if (res.writableEnded) {
				return;
			}
			res.status(200).json({success: true, data: result ?? null});
		} catch (err) {
			if (err instanceof HttpError) {
				res
					.status(err.status)
					.json({success: false, data: null, message: err.message});
				return;
			}

			console.error(`Unhandled error in ${req.url}`, err);
			res
				.status(500)
				.json({success: false, data: null, message: 'Internal server error.'});
		}
	};
}
