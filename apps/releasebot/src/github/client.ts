import type { BuildNotification } from '../domain/notification';
import type { Env } from '../env';

const GITHUB_USER_AGENT = 'releasebot/0.0.1';

export async function dispatchWorkflow(env: Env, notification: BuildNotification, environment: 'dev' | 'prod'): Promise<void> {
	const repo = notification.repository.replace(/^\/+|\/+$/g, '');
	if (!repo.includes('/')) {
		throw new Error(`repository must be owner/name: ${notification.repository}`);
	}

	const url = `${env.GITHUB_API_BASE_URL}/repos/${repo}/actions/workflows/` + `${env.RELEASEBOT_WORKFLOW_FILE}/dispatches`;

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${env.GITHUB_TOKEN}`,
			'Content-Type': 'application/json',
			'User-Agent': GITHUB_USER_AGENT,
			'X-GitHub-Api-Version': '2022-11-28',
		},
		body: JSON.stringify({
			ref: notification.ref,
			inputs: { tag: notification.tag, environment },
		}),
	});

	if (response.status !== 204) {
		const body = (await response.text()).slice(0, 4096);
		throw new Error(`github workflow dispatch failed: status=${response.status} body=${body}`);
	}
}
