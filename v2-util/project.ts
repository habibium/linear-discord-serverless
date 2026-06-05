import {z} from 'zod';
import {commonMeta, dateResolvable} from './util';

export const project = z.object({
	...commonMeta,
	type: z.literal('Project'),
	url: z.string().url(),
	data: z.object({
		id: z.string().uuid(),
		createdAt: dateResolvable,
		updatedAt: dateResolvable,
		archivedAt: dateResolvable.optional(),
		name: z.string(),
		description: z.string().optional(),
		slugId: z.string(),
		color: z.string(),
		state: z.string(),
		creatorId: z.string().uuid().optional(),
		sortOrder: z.number(),
		issueCountHistory: z.array(z.number()).optional(),
		completedIssueCountHistory: z.array(z.number()).optional(),
		scopeHistory: z.array(z.number()).optional(),
		completedScopeHistory: z.array(z.number()).optional(),
		slackIssueComments: z.boolean().optional(),
		slackIssueStatuses: z.boolean().optional(),
		teamIds: z.array(z.string().uuid()).optional(),
		memberIds: z.array(z.string().uuid()).optional(),
	}),
});
