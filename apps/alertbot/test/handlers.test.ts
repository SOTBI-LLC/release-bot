import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { payload, telegramSuccess } from './fixtures';

const stub = () => env.ALERT_OUTBOX.getByName(`${env.ENVIRONMENT}:${env.TELEGRAM_CHAT_ID}`);
const request = (body: string, headers: Record<string, string> = {}) => new Request('https://bot.test/grafana/webhook', {
	method: 'POST', headers: { Authorization: 'Bearer grafana-test-secret', ...headers }, body,
});
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
	await stub().status();
	await runInDurableObject(stub(), async (_instance, state) => {
		state.storage.sql.exec('DROP TRIGGER IF EXISTS reject_insert');
		state.storage.sql.exec('DELETE FROM notifications');
		state.storage.sql.exec('UPDATE control SET paused=0,next_send_at=0,lease_until=0,attempt_id=NULL,attempt_part=NULL WHERE id=1');
		await state.storage.deleteAlarm();
	});
});

describe('Grafana ingress', () => {
	it('returns204 only for health, not an inbound Telegram endpoint', async () => {
		expect((await app.fetch(new Request('https://bot.test/healthz'), env)).status).toBe(204);
		expect((await app.fetch(new Request('https://bot.test/telegram/webhook', { method: 'POST' }), env)).status).toBe(404);
	});
	it.each(['', 'Bearer wrong', 'Basic grafana-test-secret'])('rejects unauthorized requests before enqueue/send', async (authorization) => {
		const send = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => telegramSuccess());
		const response = await app.fetch(request('{bad', { Authorization: authorization }), env);
		expect(response.status).toBe(401); expect(send).not.toHaveBeenCalled();
	});
	it.each(['{bad', '{}', JSON.stringify({ ...payload, status: 'ok' }), JSON.stringify({ ...payload, alerts: [] })])('rejects invalid JSON/schema', async (body) => {
		expect((await app.fetch(request(body), env)).status).toBe(400);
	});
	it('bounds declared and actual streamed size', async () => {
		const cases: Record<string, string>[] = [{ 'Content-Length': '400000' }, {}];
		for (const headers of cases) {
			expect((await app.fetch(request('x'.repeat(300000), headers), env)).status).toBe(413);
		}
	});
	it('accepts durably then delivers asynchronously, returning a job ID', async () => {
		const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => telegramSuccess());
		const ctx = createExecutionContext();
		const response = await app.fetch(request(JSON.stringify(payload)), env, ctx);
		expect(response.status).toBe(202);
		const accepted = await response.json<{ accepted: boolean; notificationId: string }>();
		expect(accepted.accepted).toBe(true);
		expect(await stub().notificationStatus(accepted.notificationId)).not.toBeNull();
		await waitOnExecutionContext(ctx);
		expect(await stub().notificationStatus(accepted.notificationId)).toMatchObject({ state: 'delivered', confirmedParts: 1 });
		expect(fetch).toHaveBeenCalledTimes(1);
		const sent = JSON.parse(String(fetch.mock.calls[0][1]?.body));
		expect(sent.chat_id).toBe('-1001234567890'); expect(sent.parse_mode).toBeUndefined();
	});
	it('returns503 without claiming acceptance if queue persistence fails', async () => {
		await runInDurableObject(stub(), async (_instance, state) => {
			state.storage.sql.exec(`CREATE TRIGGER reject_insert BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'test-failure'); END`);
		});
		const response = await app.fetch(request(JSON.stringify(payload)), env, createExecutionContext());
		expect(response.status).toBe(503);
		expect(await stub().status()).toMatchObject({ depth: 0 });
	});
	it('protects diagnostics and pause with a separate secret', async () => {
		for (const path of ['/delivery/status', '/delivery/status/id', '/delivery/pause', '/delivery/resume']) {
			const method = path.endsWith('pause') || path.endsWith('resume') ? 'POST' : 'GET';
			const response = await app.fetch(new Request('https://bot.test' + path, { method, headers: { Authorization: 'Bearer grafana-test-secret' } }), env);
			expect(response.status).toBe(401);
		}
		const headers = { Authorization: 'Bearer admin-test-secret' };
		expect((await app.fetch(new Request('https://bot.test/delivery/pause', { method: 'POST', headers }), env)).status).toBe(200);
		const response = await app.fetch(new Request('https://bot.test/delivery/status', { headers }), env);
		expect(await response.json()).toMatchObject({ paused: true });
		expect((await app.fetch(new Request('https://bot.test/delivery/status/missing', { headers }), env)).status).toBe(404);
	});
});
