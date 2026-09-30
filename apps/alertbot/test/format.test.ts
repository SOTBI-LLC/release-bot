import { describe, expect, it } from 'vitest';
import { deliveryText, formatSummary, HEADER_RESERVE, splitSummary, TELEGRAM_LIMIT } from '../src/format';
import { grafanaNotificationSchema } from '../src/grafana';
import { notification, payload } from './fixtures';

describe('Grafana group formatting', () => {
	it('preserves states, labels, conditions, timestamps and available links', () => {
		const text = formatSummary(notification());
		for (const expected of ['FIRING', 'ProductionNoPrimary', 'critical', 'sotbi-prod-ha', 'member: db1', 'Нет primary', 'fresh count = 0', '2026-09-30T08:00:00Z', 'https://dash.ourzoo.ru']) expect(text).toContain(expected);
		expect(text).not.toContain('Завершено: 0001');
	});
	it('supports mixed groups, missing optional annotations and unknown extra fields', () => {
		const n = grafanaNotificationSchema.parse({ ...payload, futureField: true, alerts: [payload.alerts[0], {
			status: 'resolved', labels: { alertname: 'ProductionWriteFailed' }, startsAt: '2026-09-30T08:00:00Z', endsAt: '2026-09-30T08:01:00Z',
		}] });
		const text = formatSummary(n);
		expect(text).toContain('1. FIRING'); expect(text).toContain('2. RESOLVED');
		expect(text).toContain('Восстановление записи НЕ подтверждено'); expect(text).toContain('Завершено:');
	});
	it.each(['ProductionWriteFailed', 'ProductionWriteProbeStale', 'EtcdNoSpace'])('preserves resolved caveats for %s', (name) => {
		const n = notification(); n.alerts[0].status = 'resolved'; n.alerts[0].labels.alertname = name;
		const text = formatSummary(n);
		expect(text).toContain('само по себе не подтверждает');
		expect(text).toContain(name === 'EtcdNoSpace' ? 'вручную' : 'успешный write probe');
	});
	it('marks an upstream truncated group explicitly', () => {
		const n = notification(); n.truncatedAlerts = 3;
		expect(formatSummary(n)).toContain('не включила 3 алертов');
	});
	it.each(['😀'.repeat(9000), 'x'.repeat(18000), '<b> _raw_\n'.repeat(1600), 'a'.repeat(TELEGRAM_LIMIT - HEADER_RESERVE - 1) + '😀tail'])('splits without losing Unicode or arbitrary text', (text) => {
		const parts = splitSummary(text);
		expect(parts.join('')).toBe(text);
		for (const [index, body] of parts.entries()) {
			expect(body.isWellFormed()).toBe(true);
			expect(deliveryText(body, '00000000-0000-0000-0000-000000000000', 0, index + 1, parts.length, 100000).length).toBeLessThanOrEqual(4096);
		}
	});
	it('renders late-send headers from actual attempt time', () => {
		const text = deliveryText('FIRING', 'id', 0, 1, 1, 3600000);
		expect(text).toContain('ЗАДЕРЖАННАЯ ДОСТАВКА');
		expect(text).toContain('1970-01-01T00:00:00.000Z'); expect(text).toContain('1970-01-01T01:00:00.000Z');
	});
});


it.each(['ProductionNoPrimary', 'ProductionPrimaryVisibilityLost', 'ProductionWriteFailed', 'ProductionWriteProbeStale'])('prioritizes%s in a mixed group for both states', async (alertname) => {
	const { notificationPriority } = await import('../src/grafana');
	for (const status of ['firing', 'resolved'] as const) {
		const item = grafanaNotificationSchema.parse({ ...payload, status, alerts: [
			{ ...payload.alerts[0], labels: { alertname: 'EtcdNoSpace' } },
			{ ...payload.alerts[0], status, labels: { alertname } },
		] });
		expect(notificationPriority(item)).toBe(1);
	}
	const normal = grafanaNotificationSchema.parse({ ...payload, alerts: [{ ...payload.alerts[0], labels: { alertname: 'EtcdNoSpace' } }] });
	expect(notificationPriority(normal)).toBe(0);
});
