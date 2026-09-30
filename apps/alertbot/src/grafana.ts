import { z } from 'zod';

const status = z.enum(['firing', 'resolved']);
const strings = z.record(z.string(), z.string());
const timestamp = z.iso.datetime({ offset: true });

export const grafanaNotificationSchema = z.object({
	status,
	groupKey: z.string(),
	receiver: z.string().optional(),
	title: z.string().optional(),
	message: z.string().optional(),
	externalURL: z.string().optional(),
	groupLabels: strings.default({}),
	commonLabels: strings.default({}),
	commonAnnotations: strings.default({}),
	truncatedAlerts: z.number().int().nonnegative().default(0),
	alerts: z.array(z.object({
		status,
		labels: strings,
		annotations: strings.default({}),
		startsAt: timestamp,
		endsAt: timestamp.optional(),
		generatorURL: z.string().optional(),
		dashboardURL: z.string().optional(),
		panelURL: z.string().optional(),
		fingerprint: z.string().optional(),
	})).min(1),
});

export type GrafanaNotification = z.infer<typeof grafanaNotificationSchema>;

export class BodyTooLarge extends Error {}

export async function readJson(request: Request, limit: number): Promise<unknown> {
	const declaredLength = request.headers.get('content-length');
	if (declaredLength && Number(declaredLength) > limit) throw new BodyTooLarge();
	if (!request.body) throw new SyntaxError('empty body');
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				await reader.cancel();
				throw new BodyTooLarge();
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
}

const urgentAlerts = new Set(['ProductionNoPrimary', 'ProductionPrimaryVisibilityLost', 'ProductionWriteFailed', 'ProductionWriteProbeStale']);
export function notificationPriority(notification: z.infer<typeof grafanaNotificationSchema>): 0 | 1 {
	return notification.alerts.some(alert => urgentAlerts.has(alert.labels.alertname)) ? 1 : 0;
}
