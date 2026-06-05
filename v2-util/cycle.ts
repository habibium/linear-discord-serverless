import {z} from 'zod';
import {commonMeta, dateResolvable, nullableDate} from './util';

export const cycle = z.object({
	...commonMeta,
	type: z.literal('Cycle'),
	data: z.object({
		id: z.string().uuid(),
		createdAt: dateResolvable,
		updatedAt: dateResolvable,
		archivedAt: nullableDate,
		number: z.number(),
		startsAt: dateResolvable,
		endsAt: dateResolvable,
		issueCountHistory: z.array(z.number()).nullish(),
		completedIssueCountHistory: z.array(z.number()).nullish(),
		scopeHistory: z.array(z.number()).nullish(),
		completedScopeHistory: z.array(z.number()).nullish(),
		teamId: z.string().uuid(),
		uncompletedIssuesUponCloseIds: z.array(z.string().uuid()).nullish(),
	}),
});
