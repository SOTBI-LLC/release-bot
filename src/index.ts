import { Hono } from 'hono';
import { BuildNotificationSchema } from './domain/notification';
import type { Env } from './env';
import { hasSharedSecret } from './security';
import { getReleaseStore } from './storage/client';
import { createBot } from './telegram/bot';
import { releaseKeyboard, renderBuildMessage } from './telegram/view';

export { ReleaseStore } from './storage/releaseStore';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.body(null, 204));

app.post('/build-notifications', async (c) => {
	if (!hasSharedSecret(c.req.header('X-Releasebot-Secret') ?? null, c.env.RELEASEBOT_SHARED_SECRET)) {
		return c.text('unauthorized', 401);
	}

	const json = await c.req.json().catch(() => null);
	const parsed = BuildNotificationSchema.safeParse(json);
	if (!parsed.success) {
		return c.text(parsed.error.message, 400);
	}

	const store = getReleaseStore(c.env);
	const releaseId = await store.create(parsed.data);

	const bot = createBot(c.env);
	await bot.api.sendMessage(c.env.TELEGRAM_CHAT_ID, renderBuildMessage(parsed.data), {
		parse_mode: 'Markdown',
		reply_markup: releaseKeyboard(releaseId),
	});

	return c.json({ release_id: releaseId }, 202);
});

app.post('/telegram/webhook', async (c) => {
	const expected = c.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
	if (expected && c.req.header('X-Telegram-Bot-Api-Secret-Token') !== expected) {
		return c.text('unauthorized', 401);
	}

	const update = await c.req.json();
	await createBot(c.env).handleUpdate(update);

	return c.body(null, 204);
});

export default app;
