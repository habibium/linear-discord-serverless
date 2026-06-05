/**
 * Per-project webhook routing.
 *
 * Set `LDS_PROJECT_ROUTES` to a JSON object mapping a Linear `projectId` to a
 * full Discord webhook URL. When an Issue event arrives whose `projectId`
 * matches one of these entries, the embed is sent to that webhook instead of
 * the default one encoded in the request URL.
 *
 * Example:
 *   LDS_PROJECT_ROUTES='{
 *     "11111111-1111-1111-1111-111111111111": "https://discord.com/api/webhooks/ID1/TOKEN1",
 *     "22222222-2222-2222-2222-222222222222": "https://discord.com/api/webhooks/ID2/TOKEN2"
 *   }'
 */

type RouteMap = Record<string, string>;

let cached: RouteMap | null = null;

export function getProjectRoutes(env = process.env.LDS_PROJECT_ROUTES): RouteMap {
	if (cached) {
		return cached;
	}

	if (!env) {
		cached = {};
		return cached;
	}

	try {
		const parsed = JSON.parse(env);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			cached = parsed as RouteMap;
			return cached;
		}
	} catch (err) {
		console.warn('Failed to parse LDS_PROJECT_ROUTES as JSON:', err);
	}

	cached = {};
	return cached;
}

export function resolveWebhookUrl(
	projectId: string | undefined,
	defaultUrl: string,
): string {
	if (!projectId) {
		return defaultUrl;
	}
	const routes = getProjectRoutes();
	return routes[projectId] ?? defaultUrl;
}

// Exposed so tests can reset state between cases.
export function __resetRouteCache() {
	cached = null;
}
