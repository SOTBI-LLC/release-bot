import type { GrafanaNotification } from './grafana';

export const TELEGRAM_LIMIT = 4096;
// Includes timestamps, UUID, delayed marker and part numbers, even at the ingress cap.
export const HEADER_RESERVE = 320;

function pairs(values: Record<string, string>): string[] {
	return Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}: ${value}`);
}

export function formatSummary(notification: GrafanaNotification): string {
	const lines = [`${notification.status.toUpperCase()} — ${notification.title || 'Grafana Alerting'}`];
	lines.push(...pairs(notification.groupLabels));
	if (notification.truncatedAlerts > 0) lines.push(`ВНИМАНИЕ: Grafana не включила ${notification.truncatedAlerts} алертов; группа неполная.`);
	for (const [index, alert] of notification.alerts.entries()) {
		lines.push('', `${index + 1}. ${alert.status.toUpperCase()} — ${alert.labels.alertname || 'Alert'}`);
		lines.push(...pairs({ ...notification.commonLabels, ...alert.labels }));
		lines.push(...pairs({ ...notification.commonAnnotations, ...alert.annotations }));
		lines.push(`Началось: ${alert.startsAt}`);
		if (alert.endsAt && !alert.endsAt.startsWith('0001-')) lines.push(`Завершено: ${alert.endsAt}`);
		for (const [name, url] of [['Источник', alert.generatorURL], ['Dashboard', alert.dashboardURL], ['Panel', alert.panelURL]]) {
			if (url) lines.push(`${name}: ${url}`);
		}
		if (alert.status === 'resolved') {
			lines.push('Resolved: Grafana больше не считает алерт firing; это само по себе не подтверждает восстановление сервиса.');
			if (['ProductionWriteFailed', 'ProductionWriteProbeStale'].includes(alert.labels.alertname)) {
				lines.push('Восстановление записи НЕ подтверждено. Требуется новый успешный write probe.');
			}
			if (alert.labels.alertname === 'EtcdNoSpace') {
				lines.push('NOSPACE disarm выполняется вручную только после подтверждённого освобождения места.');
			}
		}
	}
	if (notification.externalURL) lines.push('', `Grafana: ${notification.externalURL}`);
	return lines.join('\n');
}

export function splitSummary(text: string): string[] {
	const max = TELEGRAM_LIMIT - HEADER_RESERVE;
	const parts: string[] = [];
	let rest = text;
	while (rest.length > max) {
		let end = max;
		const last = rest.charCodeAt(end - 1);
		if (last >= 0xd800 && last <= 0xdbff) end--;
		const boundary = Math.max(rest.lastIndexOf('\n', end - 1), rest.lastIndexOf(' ', end - 1));
		if (boundary >= Math.floor(max / 2)) end = boundary + 1;
		parts.push(rest.slice(0, end));
		rest = rest.slice(end);
	}
	if (rest || parts.length === 0) parts.push(rest);
	return parts;
}

export function deliveryText(body: string, id: string, receivedAt: number, part: number, total: number, now: number): string {
	const delayed = now - receivedAt > 60_000 ? 'ЗАДЕРЖАННАЯ ДОСТАВКА\n' : '';
	const header = `${delayed}Принято: ${new Date(receivedAt).toISOString()}\nОтправка: ${new Date(now).toISOString()}\nID: ${id} | ${part}/${total}\n\n`;
	if (header.length > HEADER_RESERVE || header.length + body.length > TELEGRAM_LIMIT) throw new Error('message_length');
	return header + body;
}
