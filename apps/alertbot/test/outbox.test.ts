import { runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertOutbox, CHAT_INTERVAL_MS, RETENTION_MS, RETRY_WINDOW_MS } from '../src/outbox';
import { telegramSuccess } from './fixtures';

const NOW = 2000000000000;
const newQueue = () => env.ALERT_OUTBOX.getByName(crypto.randomUUID());
const clock = () => vi.spyOn(Date, 'now').mockReturnValue(NOW);
afterEach(() => vi.restoreAllMocks());

describe('persistent outbox', () => {
	it('stores independent reminders and monotonic concurrent enqueue order', async () => {
		clock(); const queue = newQueue();
		const results = await Promise.all([queue.enqueue(['same'], 'group'), queue.enqueue(['same'], 'group'), queue.enqueue(['resolved'], 'group')]);
		expect(new Set(results.map(r => r.notificationId)).size).toBe(3);
		const jobs = await Promise.all(results.map(r => queue.notificationStatus(r.notificationId!)));
		expect(jobs.map(j => j?.sequence)).toEqual([1, 2, 3]);
		await runInDurableObject(queue, async (_instance, state) => {
			const rows = state.storage.sql.exec<{ parts: string }>('SELECT parts FROM notifications ORDER BY sequence').toArray();
			expect(rows.map(row => JSON.parse(row.parts))).toEqual([['same'], ['same'], ['resolved']]);
			expect(await state.storage.getAlarm()).not.toBeNull();
		});
	});
	it('resumes persisted state with a reconstructed object', async () => {
		clock(); const queue = newQueue(); const result = await queue.enqueue(['pending']);
		await queue.setPaused(true);
		await runInDurableObject(queue, async (_instance, state) => {
			const restarted = new AlertOutbox(state, env);
			expect(await restarted.status()).toMatchObject({ paused: true, depth: 1 });
			expect(await restarted.notificationStatus(result.notificationId!)).toMatchObject({ state: 'queued', confirmedParts: 0 });
		});
	});
	it('recovers a persisted reservation after its lease without a new webhook', async () => {
		const time = clock(); const queue = newQueue(); const result = await queue.enqueue(['pending']);
		await runInDurableObject(queue, async (_instance, state) => {
			state.storage.sql.exec('UPDATE control SET lease_until=?,revision=1,attempt_id=?,attempt_part=0 WHERE id=1', NOW + 30000, result.notificationId!);
		});
		const send = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => telegramSuccess());
		await queue.drain(); expect(send).not.toHaveBeenCalled();
		time.mockReturnValue(NOW + 30001); await runDurableObjectAlarm(queue);
		expect(send).toHaveBeenCalledTimes(1);
		expect(await queue.notificationStatus(result.notificationId!)).toMatchObject({ state: 'delivered' });
	});
	it('does not replay acknowledged parts after a later failure and restart', async () => {
		const time = clock(); const queue = newQueue(); const result = await queue.enqueue(['first', 'second']);
		const send = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => telegramSuccess(1)).mockImplementationOnce(async () => Response.json({ ok: false, error_code: 503, description: 'unavailable' })).mockImplementation(async () => telegramSuccess(2));
		await queue.drain(); time.mockReturnValue(NOW + CHAT_INTERVAL_MS); await queue.drain();
		const job = await queue.notificationStatus(result.notificationId!);
		expect(job).toMatchObject({ state: 'partial', confirmedParts: 1, lastError: 'telegram_503' });
		time.mockReturnValue(job!.nextAttemptAt);
		await runInDurableObject(queue, async (_instance, state) => { await new AlertOutbox(state, env).drain(); });
		const texts = send.mock.calls.map(call => JSON.parse(String(call[1]?.body)).text);
		expect(texts[0]).toContain('first'); expect(texts[1]).toContain('second'); expect(texts[2]).toContain('second');
		expect(await queue.notificationStatus(result.notificationId!)).toMatchObject({ state: 'delivered', confirmedParts: 2 });
	});
	it('honors429 retry_after for the whole chat and retains order', async () => {
		const time = clock(); const queue = newQueue(); const first = await queue.enqueue(['firing']); const second = await queue.enqueue(['resolved'], 'same-group');
		const send = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => Response.json({ ok: false, error_code: 429, description: 'flood', parameters: { retry_after: 60 } })).mockImplementation(async () => telegramSuccess());
		await queue.drain();
		expect(await queue.status()).toMatchObject({ nextSendAt: NOW + 60000 });
		time.mockReturnValue(NOW + 59999); await queue.drain(); expect(send).toHaveBeenCalledTimes(1);
		time.mockReturnValue(NOW + 60000); await queue.drain();
		expect(await queue.notificationStatus(first.notificationId!)).toMatchObject({ state: 'delivered' });
		expect(await queue.notificationStatus(second.notificationId!)).toMatchObject({ state: 'queued' });
		time.mockReturnValue(NOW + 64000); await queue.drain();
		expect(send.mock.calls.map(call => JSON.parse(String(call[1]?.body)).text).map(text => text.endsWith('firing') ? 'firing' : 'resolved')).toEqual(['firing', 'firing', 'resolved']);
	});
	it('preserves firing/resolved history after an hour outage with delayed timestamps', async () => {
		const time = clock(); const queue = newQueue();
		await queue.enqueue(['firing'], 'same-group'); time.mockReturnValue(NOW + 10000); await queue.enqueue(['resolved'], 'same-group');
		const send = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network token=must-not-leak')).mockImplementation(async () => telegramSuccess());
		await queue.drain(); time.mockReturnValue(NOW + 3600000); await queue.drain();
		time.mockReturnValue(NOW + 3604000); await queue.drain();
		const texts = send.mock.calls.slice(1).map(call => JSON.parse(String(call[1]?.body)).text);
		expect(texts[0]).toContain('firing'); expect(texts[1]).toContain('resolved');
		for (const text of texts) expect(text).toContain('ЗАДЕРЖАННАЯ ДОСТАВКА');
	});
	it('keeps scheduling retries beyond the platform automatic six-retry budget', async () => {
		const time = clock(); const queue = newQueue(); const result = await queue.enqueue(['alert']);
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ ok: false, error_code: 500, description: 'down' }));
		for (let i = 0; i < 8; i++) {
			await runDurableObjectAlarm(queue);
			const job = await queue.notificationStatus(result.notificationId!);
			expect(job?.state).toBe('retry'); time.mockReturnValue(job!.nextAttemptAt);
		}
		expect(await queue.notificationStatus(result.notificationId!)).toMatchObject({ attempts: 8 });
		await runInDurableObject(queue, async (_instance, state) => expect(await state.storage.getAlarm()).not.toBeNull());
	});
	it.each([400, 401, 403])('finalizes permanent Telegram error%s without leaking remote descriptions', async (code) => {
		clock(); const queue = newQueue(); const result = await queue.enqueue(['sensitive body']);
		const log = vi.spyOn(console, 'info');
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ ok: false, error_code: code, description: 'bot123456:secret-token https://api.telegram.org/secret' }));
		await queue.drain();
		expect(await queue.notificationStatus(result.notificationId!)).toMatchObject({ state: 'failed', lastError: `telegram_${code}` });
		expect(JSON.stringify(log.mock.calls)).not.toContain('secret-token');
		await runInDurableObject(queue, async (_instance, state) => expect(state.storage.sql.exec<{ parts: string | null }>('SELECT parts FROM notifications').one().parts).toBeNull());
	});
	it('expires after24h, frees the head, and removes terminal metadata after7days', async () => {
		const time = clock(); const queue = newQueue(); const first = await queue.enqueue(['old']);
		await queue.setPaused(true); time.mockReturnValue(NOW + RETRY_WINDOW_MS); await queue.status();
		expect(await queue.notificationStatus(first.notificationId!)).toMatchObject({ state: 'expired' });
		await queue.enqueue(['new']); await queue.setPaused(false);
		const send = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => telegramSuccess()); await queue.drain(); expect(send).toHaveBeenCalledTimes(1);
		time.mockReturnValue(NOW + RETRY_WINDOW_MS + RETENTION_MS + 1); await runDurableObjectAlarm(queue);
		expect(await queue.notificationStatus(first.notificationId!)).toBeNull(); expect((await queue.status()).depth).toBe(0);
	});
	it('does not shift an earlier alarm on enqueue', async () => {
		const time = clock(); const queue = newQueue(); await queue.enqueue(['first']);
		let before = 0;
		await runInDurableObject(queue, async (_instance, state) => { before = (await state.storage.getAlarm())!; });
		time.mockReturnValue(NOW); await queue.enqueue(['second']);
		await runInDurableObject(queue, async (_instance, state) => expect(await state.storage.getAlarm()).toBe(before));
	});
	it('rejects capacity overflow without deleting previously accepted jobs', async () => {
		clock(); const queue = newQueue(); await queue.setPaused(true);
		await runInDurableObject(queue, async (_instance, state) => {
			const small = new AlertOutbox(state, { ...env, OUTBOX_MAX_PENDING: '2', OUTBOX_MAX_BYTES: '50' });
			expect((await small.enqueue(['first'])).accepted).toBe(true);
			expect((await small.enqueue(['second'])).accepted).toBe(true);
			expect((await small.enqueue(['overflow'])).accepted).toBe(false);
			expect((await small.status()).depth).toBe(2);
		});
	});
});

describe('outbox concurrency and rollback', () => {
	it('blocks simultaneous drain/alarms while a send is reserved, and pauses pending work', async () => {
		const time = clock(); const queue = newQueue();
		const first = await queue.enqueue(['first']); await queue.enqueue(['next']);
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const send = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { await gate; return telegramSuccess(); });
		const flight = queue.drain();
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(await queue.setPaused(true)).toMatchObject({ paused: true, inFlight: true });
		await Promise.all([queue.drain(), queue.drain()]); expect(send).toHaveBeenCalledTimes(1);
		release(); await flight;
		expect(await queue.notificationStatus(first.notificationId!)).toMatchObject({ state: 'delivered' });
		time.mockReturnValue(NOW + 4000); await queue.drain(); expect(send).toHaveBeenCalledTimes(1);
		await queue.setPaused(false); await queue.drain(); expect(send).toHaveBeenCalledTimes(2);
	});
	it('finishes all head parts before the next group and enforces chat spacing', async () => {
		const time = clock(); const queue = newQueue(); await queue.enqueue(['part1', 'part2']); await queue.enqueue(['resolved'], 'same-group');
		const send = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => telegramSuccess());
		await queue.drain(); time.mockReturnValue(NOW + 3999); await queue.drain(); expect(send).toHaveBeenCalledTimes(1);
		time.mockReturnValue(NOW + 4000); await queue.drain(); time.mockReturnValue(NOW + 8000); await queue.drain();
		expect(send.mock.calls.map(call => JSON.parse(String(call[1]?.body)).text.split('\n').at(-1))).toEqual(['part1', 'part2', 'resolved']);
	});
	it('rolls back an insert if scheduling fails, preserving earlier accepted work', async () => {
		clock(); const queue = newQueue(); await queue.enqueue(['existing']);
		await runInDurableObject(queue, async (instance, state) => {
			const failure = vi.spyOn(Object.getPrototypeOf(instance), 'schedule').mockRejectedValueOnce(new Error('alarm unavailable'));
			// Test helper constrains env to generated literal vars; the runtime class widens vars.
			const actual = instance as unknown as AlertOutbox;
			try { await expect(actual.enqueue(['not-accepted'])).rejects.toThrow('alarm unavailable'); }
			finally { failure.mockRestore(); }
			expect(state.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM notifications').one().count).toBe(1);
		});
	});
	it('applies byte capacity separately from count and returns no payload in metadata', async () => {
		clock(); const queue = newQueue();
		await runInDurableObject(queue, async (_instance, state) => {
			const small = new AlertOutbox(state, { ...env, OUTBOX_MAX_BYTES: '12' });
			const first = await small.enqueue(['first']); expect(first.accepted).toBe(true);
			expect((await small.enqueue(['large-payload'])).accepted).toBe(false);
			const status = await small.notificationStatus(first.notificationId!);
			expect(status?.messageIds).toEqual([]);
			expect((await small.status()).recent).toEqual([{ notificationId: first.notificationId, state: 'queued' }]);
			expect(status).not.toHaveProperty('parts'); expect(JSON.stringify(status)).not.toContain('first');
		});
	});
});

describe('priority between groups', () => {
	it('preempts a normal multipart summary while preserving each group history', async () => {
		const time = clock(); const queue = newQueue();
		await queue.enqueue(['normal-1', 'normal-2'], 'normal');
		const send = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => telegramSuccess());
		await queue.drain();
		await queue.enqueue(['normal-resolved'], 'normal', 1);
		await queue.enqueue(['urgent-firing'], 'urgent', 1);
		await queue.enqueue(['urgent-resolved'], 'urgent', 1);
		for (let i = 1; i <= 4; i++) { time.mockReturnValue(NOW + i * CHAT_INTERVAL_MS); await queue.drain(); }
		expect(send.mock.calls.map(call => JSON.parse(String(call[1]?.body)).text.split('\n').at(-1)))
			.toEqual(['normal-1', 'urgent-firing', 'urgent-resolved', 'normal-2', 'normal-resolved']);
	});
	it('does not let a retrying group block another ready urgent group', async () => {
		const time = clock(); const queue = newQueue();
		const first = await queue.enqueue(['failing-firing'], 'first');
		await queue.enqueue(['blocked-resolved'], 'first', 1);
		const send = vi.spyOn(globalThis, 'fetch')
			.mockImplementationOnce(async () => Response.json({ ok: false, error_code: 503 }))
			.mockImplementation(async () => telegramSuccess());
		await queue.drain();
		await queue.enqueue(['other-urgent'], 'other', 1);
		time.mockReturnValue(NOW + CHAT_INTERVAL_MS); await queue.drain();
		expect(JSON.parse(String(send.mock.calls[1][1]?.body)).text).toContain('other-urgent');
		expect(await queue.notificationStatus(first.notificationId!)).toMatchObject({ state: 'retry', confirmedParts: 0 });
	});
});
