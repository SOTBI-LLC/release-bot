import { hasSharedSecret } from '@bots/telegram-worker';
import { Hono } from 'hono';
import { createBot } from './bot';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.body(null, 204));
app.post('/telegram/webhook', async (c) => {
	if (!hasSharedSecret(c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? null, c.env.TELEGRAM_WEBHOOK_SECRET_TOKEN)) {
		return c.text('unauthorized', 401);
	}

	const update = await c.req.json();
	try {
		await createBot(c.env).handleUpdate(update);
	} catch (error) {
		// Acknowledge failed handlers to avoid repeating side effects on Telegram retries.
		console.error('telegram webhook handler failed', { error: String(error) });
	}
	return c.body(null, 204);
});

export default app;
