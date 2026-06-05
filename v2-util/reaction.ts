import {z} from 'zod';
import {commonMeta, dateResolvable, nullableDate} from './util';

export const reaction = z.object({
	...commonMeta,
	type: z.literal('Reaction'),
	data: z.object({
		id: z.string().uuid(),
		createdAt: dateResolvable,
		updatedAt: dateResolvable,
		archivedAt: nullableDate,
		emoji: z.string(),
		userId: z.string().uuid(),
		commentId: z.string().uuid(),
		comment: z.object({
			id: z.string().uuid(),
			body: z.string(),
			userId: z.string().uuid(),
		}),
		user: z.object({
			id: z.string().uuid(),
			name: z.string(),
		}),
	}),
});
