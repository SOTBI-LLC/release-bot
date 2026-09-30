import { createTelegramBot } from '@bots/telegram-worker';
import type { Bot, Context } from 'grammy';
import { ACTION_DEPLOY, ACTION_NOOP, ACTION_RELEASE, parseCallbackData } from '../domain/callback';
import type { Env } from '../env';
import { dispatchWorkflow } from '../github/client';
import { getReleaseStore } from '../storage/client';
import { environmentKeyboard, postDeployEnvironmentKeyboard } from './view';

export function createBot(env: Env): Bot {
	const bot = createTelegramBot(env);

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

		// Answer the callback query before any slow work. Telegram invalidates the
		// query ID ~60s after the button press, and the GitHub dispatch + Durable
		// Object round-trips below can exceed that window, which previously caused
		// `400: query is too old`.
		await ctx.answerCallbackQuery({ text: `Deploying to ${environment}…` });

		try {
			await dispatchWorkflow(env, entry.notification, environment);
		} catch (error) {
			// Do not throw: a thrown error here surfaces as a 500 to Telegram, which
			// retries the update and would re-run the (non-idempotent) dispatch.
			// Report to the chat instead and stop.
			console.error('workflow dispatch failed', {
				environment,
				releaseId: callbackData.releaseId,
				error: String(error),
			});
			await ctx.reply(`❌ Failed to start deploy to ${environment}: ${String(error)}`).catch(() => {});
			return;
		}

		await store.markDeployed(callbackData.releaseId, environment);
		const status = await store.deploymentStatus(callbackData.releaseId);

		await ctx.editMessageReplyMarkup({
			reply_markup: postDeployEnvironmentKeyboard(callbackData.releaseId, status.devDone, status.prodDone),
		});
	}
}

function isAllowedUser(env: Env, userId: number): boolean {
	return env.TELEGRAM_ALLOWED_USER_IDS.split(',')
		.map((value) => value.trim())
		.filter(Boolean)
		.map(Number)
		.includes(userId);
}
