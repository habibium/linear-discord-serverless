import dayjs from 'dayjs';
import {z} from 'zod';

/**
 * Get the issue ID from url
 * @param link issue url
 */
export function getId(link: string): string {
	const parts = link.split('/');
	const last = parts[5] ?? '';
	return last.split('#')[0] ?? '';
}

/**
 * Schema for a value that could be resolved into a date.
 */
export const dateResolvable = z
	.date()
	.or(z.string())
	.transform(value => dayjs(value));

/**
 * Date-resolvable that also accepts `null` / `undefined`, which Linear sends
 * for unset timestamp fields (archivedAt, dueDate, …).
 */
export const nullableDate = z
	.date()
	.or(z.string())
	.nullish()
	.transform(value => (value == null ? null : dayjs(value)));

export enum Action {
	CREATE = 'create',
	UPDATE = 'update',
	REMOVE = 'remove',
}

export const defaultAction = z.enum([
	Action.CREATE,
	Action.UPDATE,
	Action.REMOVE,
]);

const actorSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	email: z.string().optional(),
	url: z.string().url().optional(),
	avatarUrl: z.string().url().optional(),
});

/**
 * Properties every Linear webhook envelope ships with — `webhookId`,
 * `webhookTimestamp`, and `actor` are recent additions and remain optional
 * so mock or historical payloads still parse.
 */
export const commonMeta = {
	organizationId: z.string().uuid(),
	createdAt: dateResolvable,
	action: defaultAction,
	webhookId: z.string().optional(),
	webhookTimestamp: z.number().optional(),
	actor: actorSchema.optional(),
};
