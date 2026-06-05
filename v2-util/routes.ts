/**
 * Per-project webhook routing.
 *
 * Set `LDS_PROJECT_ROUTES` to a JSON object mapping a Linear `projectId` to a
 * full Discord webhook URL. When an Issue event arrives whose `projectId`
 * matches one of these entries, the embed is sent to that webhook instead of
 * the default one encoded in the request URL.
 */

export type RouteMap = Record<string, string>;

export function parseProjectRoutes(raw: string | undefined): RouteMap {
	if (!raw) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as RouteMap;
		}
	} catch (err) {
		console.warn('Failed to parse LDS_PROJECT_ROUTES as JSON:', err);
	}
	return {};
}

export function resolveWebhookUrl(
	routes: RouteMap,
	projectId: string | undefined,
	defaultUrl: string,
): string {
	if (!projectId) {
		return defaultUrl;
	}
	return routes[projectId] ?? defaultUrl;
}
