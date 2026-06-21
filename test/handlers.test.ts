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
});
