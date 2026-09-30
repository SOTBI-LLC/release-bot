import { createTelegramBot } from '@bots/telegram-worker';
import type { Env } from './env';

export function createBot(env: Env) {
	const bot = createTelegramBot(env);
	bot.command('start', (ctx) => ctx.reply('Привет! Это __BOT_NAME__.'));
	bot.on('message:text', (ctx) => ctx.reply(ctx.message.text));
	return bot;
}
