import {z} from 'zod';
import {comment} from './comment';
import {cycle} from './cycle';
import {issue} from './issue';
import {issueLabel} from './issue-label';
import {project} from './project';
import {reaction} from './reaction';
import {dateResolvable, defaultAction} from './util';

const actor = z.object({
	id: z.string().uuid(),
	name: z.string(),
	email: z.string().optional(),
	url: z.string().url().optional(),
	avatarUrl: z.string().url().optional(),
});

const commons = z.object({
	organizationId: z.string().uuid(),
	createdAt: dateResolvable,
	action: defaultAction,
	actor: actor.optional(),
});

export const bodySchema = commons.and(
	comment.or(issue).or(issueLabel).or(project).or(cycle).or(reaction),
);
