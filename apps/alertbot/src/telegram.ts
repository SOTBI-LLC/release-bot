import { Api, GrammyError, HttpError } from 'grammy/web';

export type SendResult =
	| { ok: true; messageId: number }
	| { ok: false; retry: boolean; code: string; retryAfterMs?: number };

// Error messages/descriptions may contain arbitrary remote text or an API URL with a token.
// Persist and log only fixed local codes and numeric Telegram error codes.
export function classifyTelegramError(error: unknown): Exclude<SendResult, { ok: true }> {
	if (error instanceof GrammyError) {
		const code = error.error_code;
		if (code === 429) {
			const retryAfter = error.parameters.retry_after;
			return { ok: false, retry: true, code: 'telegram_429', retryAfterMs: Number.isFinite(retryAfter) && retryAfter! > 0 ? retryAfter! * 1000 : 5000 };
		}
		return { ok: false, retry: code >= 500, code: `telegram_${code}` };
	}
	if (error instanceof HttpError) return { ok: false, retry: true, code: 'telegram_transport' };
	return { ok: false, retry: true, code: 'telegram_unknown' };
}

export async function sendTelegram(token: string, chatId: string, text: string): Promise<SendResult> {
	try {
		const api = new Api(token, { timeoutSeconds: 10 });
		const message = await api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } });
		if (!Number.isSafeInteger(message.message_id)) return { ok: false, retry: true, code: 'telegram_invalid_response' };
		return { ok: true, messageId: message.message_id };
	} catch (error) {
		return classifyTelegramError(error);
	}
}
