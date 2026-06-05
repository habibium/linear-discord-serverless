import {z} from 'zod';
import {comment} from './comment';
import {cycle} from './cycle';
import {issue} from './issue';
import {issueLabel} from './issue-label';
import {project} from './project';
import {reaction} from './reaction';

export const bodySchema = z.discriminatedUnion('type', [
	comment,
	issue,
	issueLabel,
	project,
	cycle,
	reaction,
]);

export type WebhookBody = z.infer<typeof bodySchema>;
