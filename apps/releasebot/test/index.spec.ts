import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { getReleaseStore } from '../src/storage/client';

const notification = {
	repository: 'example/service', ref: 'main', branch: 'main', sha: 'abc123',
	tag: 'v1.0.0', actor: 'builder', commit_message: 'Build', run_url: 'https://example.com/build/1',
};

describe('ReleaseStore after repository migration', () => {
	it('preserves release context and deployment status through the binding', async () => {
		const store = getReleaseStore(env);
		const id = await store.create(notification);
		expect((await store.get(id))?.notification).toEqual(notification);
		expect(await store.markDeployed(id, 'dev')).toBe(true);
		expect(await store.deploymentStatus(id)).toEqual({ devDone: true, prodDone: false, ok: true });
	});

	it('removes expired releases with the existing alarm', async () => {
		const store = getReleaseStore(env);
		const id = await store.create(notification);
		await runInDurableObject(store, async (_instance, state) => {
			const entry = await state.storage.get<Record<string, unknown>>(id);
			await state.storage.put(id, { ...entry, createdAt: Date.now() - 25 * 60 * 60 * 1000 });
		});
		expect(await runDurableObjectAlarm(store)).toBe(true);
		expect(await store.get(id)).toBeNull();
	});
});
