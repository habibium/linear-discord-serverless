import {z} from 'zod';
import {commonMeta, dateResolvable, nullableDate} from './util';

export const issueLabel = z.object({
	...commonMeta,
	type: z.literal('IssueLabel'),
	data: z.object({
		id: z.string().uuid(),
		createdAt: dateResolvable,
		updatedAt: dateResolvable,
		archivedAt: nullableDate,
		name: z.string(),
		color: z.string(),
		teamId: z.string().uuid().nullish(),
		creatorId: z.string().uuid().nullish(),
	}),
});
