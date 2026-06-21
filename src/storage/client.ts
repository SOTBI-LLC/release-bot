import type { Env } from '../env';

export function getReleaseStore(env: Env) {
	const id = env.RELEASE_STORE.idFromName('global');
	return env.RELEASE_STORE.get(id);
}
