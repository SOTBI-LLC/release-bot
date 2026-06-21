export const ACTION_RELEASE = 'release';
export const ACTION_DEPLOY = 'deploy';
export const ACTION_NOOP = 'noop';
export const ENV_DEV = 'dev';
export const ENV_PROD = 'prod';

export interface CallbackData {
	action: string;
	releaseId: string;
	environment?: 'dev' | 'prod';
}

export class BadCallbackError extends Error {}

export function parseCallbackData(data: string): CallbackData {
	const parts = data.split(':');
	if (parts.length < 2) {
		throw new BadCallbackError(`bad callback data: ${data}`);
	}

	if (parts[0] === ACTION_RELEASE) {
		if (parts.length !== 2) throw new BadCallbackError(`bad callback data: ${data}`);
		return { action: ACTION_RELEASE, releaseId: parts[1] };
	}

	if (parts[0] === ACTION_DEPLOY) {
		if (parts.length !== 3) throw new BadCallbackError(`bad callback data: ${data}`);
		if (parts[2] !== ENV_DEV && parts[2] !== ENV_PROD) {
			throw new BadCallbackError(`unknown environment: ${parts[2]}`);
		}
		return { action: ACTION_DEPLOY, releaseId: parts[1], environment: parts[2] };
	}

	throw new BadCallbackError(`unknown action: ${parts[0]}`);
}
