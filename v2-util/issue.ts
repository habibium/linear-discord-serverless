import {z} from 'zod';
import {commonMeta, dateResolvable, nullableDate} from './util';

const team = z.object({
	id: z.string().uuid(),
	name: z.string(),
	key: z.string(),
});

const label = z.object({
	id: z.string().uuid(),
	name: z.string(),
	color: z.string(),
});

export type Label = z.infer<typeof label>;

const state = z.object({
	id: z.string().uuid(),
	name: z.string(),
	color: z.string(),
	type: z.string(),
});

export const issue = z.object({
	...commonMeta,
	type: z.literal('Issue'),
	url: z.string().url().nullish(),
	data: z.object({
		id: z.string().uuid(),
		createdAt: dateResolvable,
		updatedAt: dateResolvable,
		archivedAt: nullableDate,
		number: z.number().positive(),
		title: z.string(),
		description: z.string().nullish(),
		priority: z.number().nullish(),
		boardOrder: z.number().nullish(),
		sortOrder: z.number().nullish(),
		previousIdentifiers: z.array(z.string()).nullish(),
		priorityLabel: z.string().nullish(),
		teamId: z.string().uuid(),
		stateId: z.string().uuid(),
		assigneeId: z.string().uuid().nullish(),
		subscriberIds: z.array(z.string().uuid()).nullish(),
		creatorId: z.string().uuid(),
		labelIds: z.array(z.string().uuid()).nullish(),
		projectId: z.string().uuid().nullish(),
		identifier: z.string().nullish(),
		url: z.string().url().nullish(),
		state,
		team,
		labels: z.array(label).nullish(),
	}),
});
