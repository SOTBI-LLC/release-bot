import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { positiveInteger } from './config';
import type { Env } from './env';
import { deliveryText } from './format';
import { sendTelegram, type SendResult } from './telegram';

export const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const CHAT_INTERVAL_MS = 4000;
const LEASE_MS = 30_000;
const pending = "state IN ('queued', 'retry', 'partial')";

type Job = {
	sequence: number; id: string; group_key: string; priority: number; received_at: number; expires_at: number; parts: string | null;
	bytes: number; total: number; next_part: number; message_ids: string; attempts: number;
	next_attempt_at: number; last_error: string | null; state: string; completed_at: number | null;
}
type Control = {
	paused: number; next_send_at: number; lease_until: number; revision: number;
	attempt_id: string | null; attempt_part: number | null;
}
interface Attempt { id: string; revision: number; part: number; text: string }

export class AlertOutbox extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS notifications (
				sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
				received_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, parts TEXT,
				group_key TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
				bytes INTEGER NOT NULL, total INTEGER NOT NULL, next_part INTEGER NOT NULL DEFAULT 0,
				message_ids TEXT NOT NULL DEFAULT '[]', attempts INTEGER NOT NULL DEFAULT 0,
				next_attempt_at INTEGER NOT NULL, last_error TEXT, state TEXT NOT NULL DEFAULT 'queued', completed_at INTEGER
			)`);
			// Upgrade local state created before priority scheduling; deployed v1 starts with these columns.
			const columns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(notifications)').toArray();
			if (!columns.some(column => column.name === 'group_key')) {
				ctx.storage.sql.exec("ALTER TABLE notifications ADD COLUMN group_key TEXT NOT NULL DEFAULT ''");
				ctx.storage.sql.exec("UPDATE notifications SET group_key=id WHERE group_key=''");
			}
			if (!columns.some(column => column.name === 'priority')) ctx.storage.sql.exec('ALTER TABLE notifications ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');
			ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS notification_group ON notifications(group_key, sequence)');
			ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS control (
				id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL DEFAULT 0,
				next_send_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
				revision INTEGER NOT NULL DEFAULT 0, attempt_id TEXT, attempt_part INTEGER
			)`);
			ctx.storage.sql.exec('INSERT OR IGNORE INTO control(id) VALUES (1)');
			ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS notification_state ON notifications(state, sequence)');
			ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS notification_cleanup ON notifications(completed_at)');
		});
	}

	private control(): Control {
		return this.ctx.storage.sql.exec<Control>('SELECT * FROM control WHERE id=1').one();
	}
	private eligibleHeads(): string {
		return `SELECT n.* FROM notifications n WHERE n.${pending}
			AND NOT EXISTS (SELECT 1 FROM notifications older WHERE older.group_key=n.group_key
				AND older.sequence<n.sequence AND older.${pending})`;
	}
	private head(now: number): Job | undefined {
		return this.ctx.storage.sql.exec<Job>(`${this.eligibleHeads()} AND n.next_attempt_at<=?
			ORDER BY n.priority DESC,n.sequence LIMIT 1`, now).toArray()[0];
	}
	private cleanup(now: number): void {
		const control = this.control();
		const inFlight = control.lease_until > now ? control.attempt_id : null;
		this.ctx.storage.sql.exec(`UPDATE notifications SET state='expired', parts=NULL, bytes=0,
			last_error='retry_window_expired', completed_at=? WHERE ${pending} AND expires_at<=? AND id!=?`, now, now, inFlight ?? '');
		this.ctx.storage.sql.exec('DELETE FROM notifications WHERE completed_at IS NOT NULL AND completed_at<=?', now - RETENTION_MS);
	}
	private async schedule(txn: DurableObjectTransaction, now: number): Promise<void> {
		const control = this.control();
		const candidates: number[] = [];
		const leaseActive = control.lease_until > now;
		const nextAttempt = this.ctx.storage.sql.exec<{ at: number | null }>(
			`SELECT MIN(next_attempt_at) AS at FROM (${this.eligibleHeads()})`,
		).one().at;
		if (leaseActive) candidates.push(control.lease_until);
		else if (nextAttempt !== null && !control.paused) candidates.push(Math.max(nextAttempt, control.next_send_at, now + 1));
		const expiry = this.ctx.storage.sql.exec<{ at: number | null }>(
			`SELECT MIN(expires_at) AS at FROM notifications WHERE ${pending} AND id!=?`, leaseActive ? control.attempt_id ?? '' : '',
		).one().at;
		if (expiry !== null) candidates.push(expiry);
		const cleanup = this.ctx.storage.sql.exec<{ at: number | null }>(
			'SELECT MIN(completed_at) + ? AS at FROM notifications WHERE completed_at IS NOT NULL', RETENTION_MS,
		).one().at;
		if (cleanup !== null) candidates.push(cleanup);
		if (candidates.length === 0) { await txn.deleteAlarm(); return; }
		let next = Math.max(now + 1, Math.min(...candidates));
		const previous = await txn.getAlarm();
		if (previous !== null && previous > now) next = Math.min(next, previous);
		await txn.setAlarm(next);
	}

	async enqueue(parts: string[], groupKey = '', priority = 0): Promise<{ accepted: boolean; notificationId?: string }> {
		if (!this.env.TELEGRAM_CHAT_ID || !this.env.TELEGRAM_BOT_TOKEN) throw new Error('missing_delivery_configuration');
		const bodies = z.array(z.string().max(3776)).min(1).parse(parts);
		const group = z.string().parse(groupKey);
		const rank = z.union([z.literal(0), z.literal(1)]).parse(priority);
		const bytes = new TextEncoder().encode(JSON.stringify(bodies) + group).byteLength;
		const maxPending = positiveInteger(this.env.OUTBOX_MAX_PENDING, 1000);
		const maxBytes = positiveInteger(this.env.OUTBOX_MAX_BYTES, 64 * 1024 * 1024);
		const id = crypto.randomUUID();
		return this.ctx.storage.transaction(async (txn) => {
			const now = Date.now(); this.cleanup(now);
			const usage = this.ctx.storage.sql.exec<{ count: number; bytes: number }>(
				`SELECT COUNT(*) AS count, COALESCE(SUM(bytes),0) AS bytes FROM notifications WHERE ${pending}`,
			).one();
			if (usage.count >= maxPending || usage.bytes + bytes > maxBytes) {
				await this.schedule(txn, now); return { accepted: false };
			}
			this.ctx.storage.sql.exec(`INSERT INTO notifications(id,received_at,expires_at,parts,bytes,total,next_attempt_at,group_key,priority)
				VALUES(?,?,?,?,?,?,?,?,?)`, id, now, now + RETRY_WINDOW_MS, JSON.stringify(bodies), bytes, bodies.length, now, group || id, rank);
			await this.schedule(txn, now);
			return { accepted: true, notificationId: id };
		});
	}

	private async reserve(): Promise<Attempt | null> {
		return this.ctx.storage.transaction(async (txn) => {
			const now = Date.now(); this.cleanup(now);
			const control = this.control(); const job = this.head(now);
			if (control.paused || control.lease_until > now || !job || Math.max(job.next_attempt_at, control.next_send_at) > now) {
				await this.schedule(txn, now); return null;
			}
			const bodies = z.array(z.string()).parse(JSON.parse(job.parts ?? '[]'));
			const text = deliveryText(bodies[job.next_part], job.id, job.received_at, job.next_part + 1, job.total, now);
			const revision = control.revision + 1;
			this.ctx.storage.sql.exec(`UPDATE control SET next_send_at=?,lease_until=?,revision=?,attempt_id=?,attempt_part=? WHERE id=1`,
				now + CHAT_INTERVAL_MS, now + LEASE_MS, revision, job.id, job.next_part);
			this.ctx.storage.sql.exec('UPDATE notifications SET attempts=attempts+1 WHERE id=?', job.id);
			await this.schedule(txn, now);
			return { id: job.id, revision, part: job.next_part, text };
		});
	}

	private async finish(attempt: Attempt, result: SendResult): Promise<void> {
		await this.ctx.storage.transaction(async (txn) => {
			const now = Date.now(); const control = this.control();
			if (control.revision !== attempt.revision || control.attempt_id !== attempt.id) return;
			const job = this.ctx.storage.sql.exec<Job>('SELECT * FROM notifications WHERE id=?', attempt.id).one();
			this.ctx.storage.sql.exec('UPDATE control SET lease_until=0,attempt_id=NULL,attempt_part=NULL WHERE id=1');
			if (result.ok) {
				const next = attempt.part + 1;
				const ids = z.array(z.number()).parse(JSON.parse(job.message_ids)); ids.push(result.messageId);
				const done = next === job.total;
				this.ctx.storage.sql.exec(`UPDATE notifications SET next_part=?,message_ids=?,state=?,
					parts=?,bytes=?,next_attempt_at=?,last_error=NULL,completed_at=? WHERE id=?`, next, JSON.stringify(ids),
					done ? 'delivered' : 'partial', done ? null : job.parts, done ? 0 : job.bytes, now, done ? now : null, job.id);
			} else if (!result.retry || now >= job.expires_at) {
				this.ctx.storage.sql.exec(`UPDATE notifications SET state=?,parts=NULL,bytes=0,last_error=?,completed_at=? WHERE id=?`,
					now >= job.expires_at ? 'expired' : 'failed', result.code, now, job.id);
			} else {
				const exponential = Math.min(300_000, 5000 * 2 ** Math.min(job.attempts - 1, 6));
				const jittered = Math.min(300_000, Math.floor(exponential * (1 + Math.random() * 0.2)));
				const retryAt = now + (result.retryAfterMs ?? jittered);
				if (result.retryAfterMs !== undefined) this.ctx.storage.sql.exec('UPDATE control SET next_send_at=MAX(next_send_at,?) WHERE id=1', retryAt);
				this.ctx.storage.sql.exec(`UPDATE notifications SET state=?,next_attempt_at=?,last_error=? WHERE id=?`,
					job.next_part > 0 ? 'partial' : 'retry', Math.min(job.expires_at, retryAt), result.code, job.id);
			}
			this.cleanup(now); await this.schedule(txn, now);
			console.info('alertbot delivery', { notificationId: job.id, part: attempt.part + 1, outcome: result.ok ? 'confirmed' : result.code });
		});
	}

	async drain(): Promise<void> {
		const attempt = await this.reserve(); if (!attempt) return;
		const result = await sendTelegram(this.env.TELEGRAM_BOT_TOKEN, this.env.TELEGRAM_CHAT_ID, attempt.text);
		await this.finish(attempt, result);
	}
	async alarm(): Promise<void> {
		try { await this.drain(); }
		catch {
			console.error('alertbot alarm', { code: 'outbox_processing_failed' });
			// Also armed before network I/O; do not rely on the limited automatic alarm retries.
			await this.ctx.storage.setAlarm(Date.now() + 5000);
		}
	}
	async setPaused(paused: boolean): Promise<{ paused: boolean; inFlight: boolean }> {
		return this.ctx.storage.transaction(async (txn) => {
			const now = Date.now();
			this.ctx.storage.sql.exec('UPDATE control SET paused=? WHERE id=1', paused ? 1 : 0);
			this.cleanup(now); await this.schedule(txn, now);
			return { paused, inFlight: this.control().lease_until > now };
		});
	}
	async status() {
		return this.ctx.storage.transaction(async (txn) => {
			const now = Date.now(); this.cleanup(now); await this.schedule(txn, now);
			const usage = this.ctx.storage.sql.exec<{ depth: number; oldest: number | null; bytes: number }>(
				`SELECT COUNT(*) AS depth, MIN(received_at) AS oldest, COALESCE(SUM(bytes),0) AS bytes FROM notifications WHERE ${pending}`,
			).one();
			const counts = this.ctx.storage.sql.exec<{ state: string; count: number }>('SELECT state,COUNT(*) AS count FROM notifications GROUP BY state').toArray();
			const control = this.control();
			const recent = this.ctx.storage.sql.exec<{ notificationId: string; state: string }>(
				'SELECT id AS notificationId,state FROM notifications ORDER BY sequence DESC LIMIT 20',
			).toArray();
			return { recent, depth: usage.depth, bytes: usage.bytes, oldestAgeMs: usage.oldest === null ? null : now - usage.oldest,
				paused: Boolean(control.paused), inFlight: control.lease_until > now, nextSendAt: control.next_send_at,
				counts: Object.fromEntries(counts.map(({ state, count }) => [state, count])) };
		});
	}
	async notificationStatus(id: string) {
		const job = this.ctx.storage.sql.exec<Job>('SELECT * FROM notifications WHERE id=?', id).toArray()[0];
		if (!job) return null;
		return { notificationId: job.id, sequence: job.sequence, priority: job.priority, state: job.state, receivedAt: job.received_at,
			expiresAt: job.expires_at, messageIds: z.array(z.number()).parse(JSON.parse(job.message_ids)), confirmedParts: job.next_part, totalParts: job.total, attempts: job.attempts,
			nextAttemptAt: job.next_attempt_at, lastError: job.last_error, completedAt: job.completed_at };
	}
}
