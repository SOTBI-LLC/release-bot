import { InlineKeyboard } from 'grammy';
import { ACTION_DEPLOY, ACTION_NOOP, ACTION_RELEASE, ENV_DEV, ENV_PROD } from '../domain/callback';
import type { BuildNotification } from '../domain/notification';

export function releaseKeyboard(releaseId: string): InlineKeyboard {
	return new InlineKeyboard().text('release', `${ACTION_RELEASE}:${releaseId}`);
}

export function environmentKeyboard(releaseId: string): InlineKeyboard {
	return new InlineKeyboard()
		.text(ENV_DEV, `${ACTION_DEPLOY}:${releaseId}:${ENV_DEV}`)
		.text(ENV_PROD, `${ACTION_DEPLOY}:${releaseId}:${ENV_PROD}`);
}

export function postDeployEnvironmentKeyboard(releaseId: string, devDone: boolean, prodDone: boolean): InlineKeyboard {
	const keyboard = new InlineKeyboard();
	addEnvironmentButton(keyboard, releaseId, ENV_DEV, devDone);
	addEnvironmentButton(keyboard, releaseId, ENV_PROD, prodDone);
	return keyboard;
}

function addEnvironmentButton(keyboard: InlineKeyboard, releaseId: string, environment: string, done: boolean): void {
	if (done) {
		keyboard.text(`✓ ${environment}`, ACTION_NOOP);
		return;
	}
	keyboard.text(environment, `${ACTION_DEPLOY}:${releaseId}:${environment}`);
}

export function renderBuildMessage(notification: BuildNotification): string {
	const branch = notification.branch || notification.ref;

	return [
		`🏗️: ${escapeMarkdown(notification.actor)} built image.`,
		`💬: ${escapeMarkdown(notification.commit_message)}`,
		`🌴: ${escapeMarkdown(branch)}`,
		`🔖: ${escapeMarkdown(notification.tag)}`,
		`👀 changes: https://github.com/${notification.repository}/commit/${notification.sha}`,
		`📋: ${notification.run_url}`,
	].join('\n');
}

function escapeMarkdown(value: string): string {
	return value.replace(/[_*`[]/g, (ch) => `\\${ch}`);
}
