import type { Env } from '../env';

export function getReleaseStore(env: Pick<Env, 'RELEASE_STORE'>) {
	const id = env.RELEASE_STORE.idFromName('global');
	return env.RELEASE_STORE.get(id);
}
