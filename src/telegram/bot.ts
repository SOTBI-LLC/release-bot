import { Bot, type Context } from 'grammy';
import { ACTION_DEPLOY, ACTION_NOOP, ACTION_RELEASE, parseCallbackData } from '../domain/callback';
import type { Env } from '../env';
import { dispatchWorkflow } from '../github/client';
import { getReleaseStore } from '../storage/client';
import { environmentKeyboard, postDeployEnvironmentKeyboard } from './view';

export function createBot(env: Env): Bot {
	const bot = new Bot(env.TELEGRAM_BOT_TOKEN, {
		botInfo: JSON.parse(env.TELEGRAM_BOT_INFO),
	});

	bot.on('callback_query:data', (ctx) => handleCallback(ctx, env));

	return bot;
}

async function handleCallback(ctx: Context, env: Env): Promise<void> {
	const data = ctx.callbackQuery!.data!;

	if (data === ACTION_NOOP) {
		await ctx.answerCallbackQuery();
		return;
	}

	if (!isAllowedUser(env, ctx.callbackQuery!.from.id)) {
		await ctx.answerCallbackQuery({
			text: 'You are not allowed to release this service',
			show_alert: true,
		});
		return;
	}

	let callbackData;
	try {
		callbackData = parseCallbackData(data);
	} catch {
		await ctx.answerCallbackQuery({ text: 'Bad callback data', show_alert: true });
		return;
	}

	const store = getReleaseStore(env);

	if (callbackData.action === ACTION_RELEASE) {
		const entry = await store.get(callbackData.releaseId);
		if (!entry) {
			await ctx.answerCallbackQuery({ text: 'Release context has expired', show_alert: true });
			return;
		}

		await ctx.editMessageReplyMarkup({
			reply_markup: environmentKeyboard(callbackData.releaseId),
		});
		await ctx.answerCallbackQuery({ text: 'Choose environment' });
		return;
	}

	if (callbackData.action === ACTION_DEPLOY) {
		const environment = callbackData.environment!;
		const entry = await store.get(callbackData.releaseId);
		if (!entry) {
			await ctx.answerCallbackQuery({ text: 'Release context has expired', show_alert: true });
			return;
		}

		try {
			await dispatchWorkflow(env, entry.notification, environment);
		} catch (error) {
			await ctx.answerCallbackQuery({ text: 'Failed to start deploy', show_alert: true });
			throw error;
		}

		await store.markDeployed(callbackData.releaseId, environment);
		const status = await store.deploymentStatus(callbackData.releaseId);

		await ctx.editMessageReplyMarkup({
			reply_markup: postDeployEnvironmentKeyboard(callbackData.releaseId, status.devDone, status.prodDone),
		});
		await ctx.answerCallbackQuery({ text: `Deploy started for ${environment}` });
	}
}

function isAllowedUser(env: Env, userId: number): boolean {
	return env.TELEGRAM_ALLOWED_USER_IDS.split(',')
		.map((value) => value.trim())
		.filter(Boolean)
		.map(Number)
		.includes(userId);
}
