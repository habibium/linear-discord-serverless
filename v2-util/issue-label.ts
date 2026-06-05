import {z} from 'zod';
import {commonMeta, dateResolvable} from './util';

export const issueLabel = z.object({
	...commonMeta,
	type: z.literal('IssueLabel'),
	data: z.object({
		id: z.string().uuid(),
		createdAt: dateResolvable,
		updatedAt: dateResolvable,
		archivedAt: dateResolvable.optional(),
		name: z.string(),
		color: z.string(),
		teamId: z.string().uuid().optional(),
		creatorId: z.string().uuid().optional(),
	}),
});
