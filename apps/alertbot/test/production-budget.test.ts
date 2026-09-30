import { env } from 'cloudflare:workers';
import { afterEach, expect, it, vi } from 'vitest';
import { formatSummary, splitSummary } from '../src/format';
import { grafanaNotificationSchema, notificationPriority } from '../src/grafana';
import { CHAT_INTERVAL_MS } from '../src/outbox';
import burst from './production-burst.json';
import { telegramSuccess } from './fixtures';

afterEach(() => vi.restoreAllMocks());
it('fits existing90s primary delivery budget behind a production DCS burst', async () => {
	const acceptedAt = 2000000000000;
	const clock = vi.spyOn(Date, 'now').mockReturnValue(acceptedAt);
	const queue = env.ALERT_OUTBOX.getByName(crypto.randomUUID());
	const accepted = [];
	for (const item of burst) {
		const notification = grafanaNotificationSchema.parse(item);
		const parts = splitSummary(formatSummary(notification));
		expect(parts.length).toBe(1); // Best case: no multipart overhead or network latency.
		accepted.push(await queue.enqueue(parts, notification.groupKey, notificationPriority(notification)));
	}
	let primaryReceivedAt = 0;
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
		if (String(init?.body).includes('ProductionNoPrimary')) primaryReceivedAt = Date.now();
		return telegramSuccess();
	});
	for (let i = 0; i < accepted.length; i++) {
		clock.mockReturnValue(acceptedAt + i * CHAT_INTERVAL_MS);
		await queue.drain();
	}
	expect(primaryReceivedAt).toBeGreaterThan(0);
	// Approved20s evaluation:80s onset→enqueue, leaving10s relay budget.
	const onset = acceptedAt - 80000;
	expect(primaryReceivedAt - onset).toBeLessThanOrEqual(90000);
});
