import { describe, expect, it } from 'vitest';
import { createTelegramBot, hasSharedSecret } from '../src';

describe('bot isolation', () => {
	it('uses each bot\'s own credentials and identity', () => {
		const first = createTelegramBot({
			TELEGRAM_BOT_TOKEN: '1:first',
			TELEGRAM_BOT_INFO: JSON.stringify({ id: 1, is_bot: true, first_name: 'First' }),
		});
		const second = createTelegramBot({
			TELEGRAM_BOT_TOKEN: '2:second',
			TELEGRAM_BOT_INFO: JSON.stringify({ id: 2, is_bot: true, first_name: 'Second' }),
		});
		expect(first).not.toBe(second);
		expect(first.token).toBe('1:first');
		expect(second.token).toBe('2:second');
		expect(first.botInfo.id).toBe(1);
		expect(second.botInfo.id).toBe(2);
	});
});

describe('shared secret', () => {
	it('accepts only a matching nonempty secret', () => {
		expect(hasSharedSecret('secret', 'secret')).toBe(true);
		expect(hasSharedSecret('secrex', 'secret')).toBe(false);
		expect(hasSharedSecret(null, 'secret')).toBe(false);
		expect(hasSharedSecret('', '')).toBe(false);
	});
});
