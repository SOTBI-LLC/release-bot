import { hasSharedSecret } from '@bots/telegram-worker';
import { Hono } from 'hono';
import { positiveInteger } from './config';
import type { Env } from './env';
import { formatSummary, splitSummary } from './format';
import { BodyTooLarge, grafanaNotificationSchema, notificationPriority, readJson } from './grafana';

export { AlertOutbox } from './outbox';
const app = new Hono<{ Bindings: Env }>();
const token = (request: Request) => /^Bearer (.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null;
const outbox = (env: Env) => env.ALERT_OUTBOX.getByName(`${env.ENVIRONMENT}:${env.TELEGRAM_CHAT_ID}`);

app.get('/healthz', (c) => c.body(null, 204));
app.post('/grafana/webhook', async (c) => {
	if (!hasSharedSecret(token(c.req.raw), c.env.GRAFANA_WEBHOOK_SECRET)) {
		console.warn('alertbot ingress', { code: 'unauthorized' });
		return c.json({ error: 'unauthorized' }, 401);
	}
	let limit: number;
	try { limit = positiveInteger(c.env.WEBHOOK_BODY_LIMIT, 262144); }
	catch { return c.json({ error: 'configuration_unavailable' }, 503); }
	let parsed;
	try {
		parsed = grafanaNotificationSchema.safeParse(await readJson(c.req.raw, limit));
	} catch (error) {
		const tooLarge = error instanceof BodyTooLarge;
		console.warn('alertbot ingress', { code: tooLarge ? 'body_too_large' : 'invalid_json' });
		return c.json({ error: tooLarge ? 'body_too_large' : 'invalid_json' }, tooLarge ? 413 : 400);
	}
	if (!parsed.success) {
		console.warn('alertbot ingress', { code: 'invalid_payload' });
		return c.json({ error: 'invalid_payload' }, 400);
	}
	try {
		const stub = outbox(c.env);
		const result = await stub.enqueue(splitSummary(formatSummary(parsed.data)), parsed.data.groupKey, notificationPriority(parsed.data));
		if (!result.accepted) {
			console.error('alertbot ingress', { code: 'outbox_full' });
			return c.json({ error: 'outbox_unavailable' }, 503);
		}
		c.executionCtx.waitUntil(stub.drain().catch(() => {
			console.error('alertbot ingress', { code: 'outbox_drain_failed', notificationId: result.notificationId });
		}));
		return c.json(result, 202);
	} catch {
		console.error('alertbot ingress', { code: 'outbox_enqueue_failed' });
		return c.json({ error: 'outbox_unavailable' }, 503);
	}
});

app.use('/delivery/*', async (c, next) => {
	if (!hasSharedSecret(token(c.req.raw), c.env.DELIVERY_ADMIN_SECRET)) return c.json({ error: 'unauthorized' }, 401);
	await next();
});
app.get('/delivery/status', async (c) => c.json(await outbox(c.env).status()));
app.get('/delivery/status/:id', async (c) => {
	const status = await outbox(c.env).notificationStatus(c.req.param('id'));
	return status ? c.json(status) : c.json({ error: 'not_found' }, 404);
});
app.post('/delivery/pause', async (c) => c.json(await outbox(c.env).setPaused(true)));
app.post('/delivery/resume', async (c) => {
	const stub = outbox(c.env);
	const result = await stub.setPaused(false);
	c.executionCtx.waitUntil(stub.drain().catch(() => console.error('alertbot resume', { code: 'outbox_drain_failed' })));
	return c.json(result);
});
app.onError(() => {
	console.error('alertbot request', { code: 'internal_error' });
	return Response.json({ error: 'service_unavailable' }, { status: 503 });
});
export default app;
