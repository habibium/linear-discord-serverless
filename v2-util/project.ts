import {z} from 'zod';
import {commonMeta, dateResolvable, nullableDate} from './util';

const projectStatus = z.object({
	id: z.string().uuid(),
	name: z.string(),
	color: z.string(),
	type: z.string(),
});

export const project = z.object({
	...commonMeta,
	type: z.literal('Project'),
	url: z.string().url().nullish(),
	data: z.object({
		id: z.string().uuid(),
		createdAt: dateResolvable,
		updatedAt: dateResolvable,
		archivedAt: nullableDate,
		name: z.string(),
		description: z.string().nullish(),
		slugId: z.string().nullish(),
		color: z.string().nullish(),
		state: z.string().nullish(),
		status: projectStatus.nullish(),
		creatorId: z.string().uuid().nullish(),
		sortOrder: z.number().nullish(),
		issueCountHistory: z.array(z.number()).nullish(),
		completedIssueCountHistory: z.array(z.number()).nullish(),
		scopeHistory: z.array(z.number()).nullish(),
		completedScopeHistory: z.array(z.number()).nullish(),
		slackIssueComments: z.boolean().nullish(),
		slackIssueStatuses: z.boolean().nullish(),
		teamIds: z.array(z.string().uuid()).nullish(),
		memberIds: z.array(z.string().uuid()).nullish(),
		url: z.string().url().nullish(),
	}),
});
