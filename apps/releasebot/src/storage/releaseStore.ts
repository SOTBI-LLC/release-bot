import { DurableObject } from 'cloudflare:workers';
import type { BuildNotification } from '../domain';

interface ReleaseEntry {
	notification: BuildNotification;
	devDeployed: boolean;
	prodDeployed: boolean;
	createdAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export class ReleaseStore extends DurableObject {
	async create(notification: BuildNotification): Promise<string> {
		const releaseId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);

		await this.ctx.storage.put<ReleaseEntry>(releaseId, {
			notification,
			devDeployed: false,
			prodDeployed: false,
			createdAt: Date.now(),
		});

		// Планируем периодическую очистку протухших релизов, если ещё не запланирована.
		if ((await this.ctx.storage.getAlarm()) === null) {
			await this.ctx.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
		}

		return releaseId;
	}

	async get(releaseId: string): Promise<ReleaseEntry | null> {
		return (await this.ctx.storage.get<ReleaseEntry>(releaseId)) ?? null;
	}

	async markDeployed(releaseId: string, environment: 'dev' | 'prod'): Promise<boolean> {
		const entry = await this.ctx.storage.get<ReleaseEntry>(releaseId);
		if (!entry) return false;

		if (environment === 'dev') entry.devDeployed = true;
		else entry.prodDeployed = true;

		await this.ctx.storage.put(releaseId, entry);
		return true;
	}

	async deploymentStatus(releaseId: string): Promise<{ devDone: boolean; prodDone: boolean; ok: boolean }> {
		const entry = await this.ctx.storage.get<ReleaseEntry>(releaseId);
		if (!entry) return { devDone: false, prodDone: false, ok: false };
		return { devDone: entry.devDeployed, prodDone: entry.prodDeployed, ok: true };
	}

	async alarm(): Promise<void> {
		const entries = await this.ctx.storage.list<ReleaseEntry>();
		const cutoff = Date.now() - TTL_MS;

		for (const [key, entry] of entries) {
			if (entry.createdAt < cutoff) await this.ctx.storage.delete(key);
		}

		const remaining = await this.ctx.storage.list();
		if (remaining.size > 0) {
			await this.ctx.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
		}
	}
}
