import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('healthz', () => {
	it('returns 204', async () => {
		const response = await exports.default.fetch('https://example.com/healthz');
		expect(response.status).toBe(204);
	});
});

describe('build-notifications', () => {
	it('rejects requests without shared secret', async () => {
		const response = await exports.default.fetch('https://example.com/build-notifications', {
			method: 'POST',
			body: JSON.stringify({}),
		});
		expect(response.status).toBe(401);
	});

	it('validates the notification after authenticating', async () => {
		const response = await exports.default.fetch('https://example.com/build-notifications', {
			method: 'POST',
			headers: { 'X-Releasebot-Secret': 'test-build-secret' },
			body: JSON.stringify({}),
		});
		expect(response.status).toBe(400);
	});
});

describe('telegram webhook', () => {
	it('rejects another bot\'s webhook secret', async () => {
		const response = await exports.default.fetch('https://example.com/telegram/webhook', {
			method: 'POST',
			headers: { 'X-Telegram-Bot-Api-Secret-Token': 'another-bot-secret' },
			body: JSON.stringify({ update_id: 1 }),
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
});
