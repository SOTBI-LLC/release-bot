import { grafanaNotificationSchema } from '../src/grafana';

export const payload = {
	receiver: 'telegram-alertbot', status: 'firing', groupKey: 'test-group',
	groupLabels: { alertname: 'ProductionNoPrimary', cluster: 'sotbi-prod-ha' },
	commonLabels: { severity: 'critical' }, commonAnnotations: {},
	alerts: [{ status: 'firing', labels: { alertname: 'ProductionNoPrimary', notify: 'patroni-prod', member: 'db1' },
		annotations: { summary: 'Нет primary', condition: 'fresh count = 0', runbook_url: 'https://dash.ourzoo.ru/d/sotbi-postgres-ha-etcd' },
		startsAt: '2026-09-30T08:00:00Z', endsAt: '0001-01-01T00:00:00Z',
		generatorURL: 'https://dash.ourzoo.ru/alerting/test/view', dashboardURL: 'https://dash.ourzoo.ru/d/sotbi-postgres-ha-etcd' }],
	truncatedAlerts: 0,
};
export const notification = () => grafanaNotificationSchema.parse(payload);
export const telegramSuccess = (id = 1) => Response.json({ ok: true, result: {
	message_id: id, date: 0, chat: { id: -1001234567890, type: 'supergroup' }, text: 'test',
} });
