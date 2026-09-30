import { exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBot } from '../src/bot';

afterEach(() => vi.restoreAllMocks());

describe('__BOT_NAME__', () => {
	it('returns 204 for healthz', async () => {
		const response = await exports.default.fetch('https://example.com/healthz');
		expect(response.status).toBe(204);
	});

	it('rejects webhooks without the bot\'s secret', async () => {
		const response = await exports.default.fetch('https://example.com/telegram/webhook', {
			method: 'POST', body: JSON.stringify({ update_id: 1 }),
		});
		expect(response.status).toBe(401);
	});

	it('accepts an authenticated update', async () => {
		const response = await exports.default.fetch('https://example.com/telegram/webhook', {
			method: 'POST',
			headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
			body: JSON.stringify({ update_id: 1 }),
		});
		expect(response.status).toBe(204);
	});

	it('replies to a text message using this bot\'s handlers', async () => {
		const telegramFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
			ok: true,
			result: { message_id: 2, date: 0, chat: { id: 42, type: 'private', first_name: 'User' }, text: 'hello' },
		}));
		const bot = createBot({
			TELEGRAM_BOT_TOKEN: '123456:test-token',
			TELEGRAM_BOT_INFO: JSON.stringify({ id: 123456, is_bot: true, first_name: 'TestBot' }),
			TELEGRAM_WEBHOOK_SECRET_TOKEN: 'test-webhook-secret',
		});
		await bot.handleUpdate({
			update_id: 2,
			message: {
				message_id: 1, date: 0, chat: { id: 42, type: 'private', first_name: 'User' }, text: 'hello',
				from: { id: 42, is_bot: false, first_name: 'User' },
			},
		});
		expect(telegramFetch).toHaveBeenCalledTimes(1);
		expect(telegramFetch.mock.calls[0][0]).toBe('https://api.telegram.org/bot123456:test-token/sendMessage');
		expect(JSON.parse(String(telegramFetch.mock.calls[0][1]?.body))).toMatchObject({ chat_id: 42, text: 'hello' });
	});
});
