import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTelegram } from '../src/telegram';
import { telegramSuccess } from './fixtures';
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('bounded Telegram adapter', () => {
	it('uses plain text without getMe and checks message_id', async () => {
		const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => telegramSuccess(23));
		expect(await sendTelegram('123456:test-token', '-100123', '<b>raw</b>')).toEqual({ ok: true, messageId: 23 });
		expect(request).toHaveBeenCalledTimes(1);
		expect(String(request.mock.calls[0][0])).toContain('/sendMessage');
		expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ text: '<b>raw</b>', chat_id: '-100123' });
	});
	it('does not acknowledge malformed successful API responses', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ ok: true, result: { message_id: 'bad' } }));
		expect(await sendTelegram('123456:test-token', '42', 'alert')).toMatchObject({ ok: false, retry: true });
	});
	it('aborts a hung fetch after10seconds and returns a sanitized retry result', async () => {
		vi.useFakeTimers();
		vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => reject(new Error('secret API URL')));
		}));
		const result = sendTelegram('123456:test-token', '42', 'alert');
		await vi.advanceTimersByTimeAsync(10000);
		expect(await result).toMatchObject({ ok: false, retry: true });
		expect(JSON.stringify(await result)).not.toContain('secret');
	});
	it('classifies non-JSON HTTP failure as retriable transport failure', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('unavailable', { status: 502 }));
		expect(await sendTelegram('123456:test-token', '42', 'alert')).toMatchObject({ ok: false, retry: true, code: 'telegram_transport' });
	});
});
