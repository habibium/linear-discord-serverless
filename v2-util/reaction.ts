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
		// Reactions attach to either a comment (legacy) or an issue
		// (current). Both shapes are nullish; the handler picks one.
		commentId: z.string().uuid().nullish(),
		comment: z
			.object({
				id: z.string().uuid(),
				body: z.string(),
				userId: z.string().uuid(),
			})
			.nullish(),
		issueId: z.string().uuid().nullish(),
		issue: z
			.object({
				id: z.string().uuid(),
				title: z.string(),
				teamId: z.string().uuid().nullish(),
				identifier: z.string().nullish(),
				url: z.string().url().nullish(),
			})
			.nullish(),
		user: z.object({
			id: z.string().uuid(),
			name: z.string(),
		}),
	}),
});
