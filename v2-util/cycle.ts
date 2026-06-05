import {z} from 'zod';
import {commonMeta, dateResolvable} from './util';

export const cycle = z.object({
	...commonMeta,
	type: z.literal('Cycle'),
	data: z.object({
		id: z.string().uuid(),
		createdAt: dateResolvable,
		updatedAt: dateResolvable,
		archivedAt: dateResolvable.optional(),
		number: z.number(),
		startsAt: dateResolvable,
		endsAt: dateResolvable,
		issueCountHistory: z.array(z.number()),
		completedIssueCountHistory: z.array(z.number()),
		scopeHistory: z.array(z.number()),
		completedScopeHistory: z.array(z.number()),
		teamId: z.string().uuid(),
		uncompletedIssuesUponCloseIds: z.array(z.string().uuid()),
	}),
});
