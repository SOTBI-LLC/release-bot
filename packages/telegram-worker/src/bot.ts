import { Bot } from 'grammy';

export interface TelegramBotEnv {
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_BOT_INFO: string;
}

// Create a separate bot per request so handlers never retain another request's bindings.
export function createTelegramBot(env: TelegramBotEnv): Bot {
	return new Bot(env.TELEGRAM_BOT_TOKEN, {
		botInfo: JSON.parse(env.TELEGRAM_BOT_INFO),
	});
}
