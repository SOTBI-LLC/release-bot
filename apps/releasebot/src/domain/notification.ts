import { z } from 'zod';

export const BuildNotificationSchema = z.object({
	repository: z.string().min(1, 'repository is required'),
	ref: z.string().min(1, 'ref is required'),
	branch: z.string().optional().default(''),
	sha: z.string().optional().default(''),
	tag: z.string().min(1, 'tag is required'),
	actor: z.string().min(1, 'actor is required'),
	commit_message: z.string().optional().default(''),
	run_url: z.string().min(1, 'run_url is required'),
});

export type BuildNotification = z.infer<typeof BuildNotificationSchema>;
