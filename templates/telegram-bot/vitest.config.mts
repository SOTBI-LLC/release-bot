import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	root: import.meta.dirname,
	plugins: [
		cloudflareTest({
			wrangler: { configPath: `${import.meta.dirname}/wrangler.jsonc` },
			miniflare: {
				bindings: {
					TELEGRAM_BOT_TOKEN: '123456:test-token',
					TELEGRAM_BOT_INFO: JSON.stringify({ id: 123456, is_bot: true, first_name: 'TestBot', username: 'test_bot' }),
					TELEGRAM_WEBHOOK_SECRET_TOKEN: 'test-webhook-secret',
				},
			},
		}),
	],
	test: { name: '__BOT_NAME__', include: ['test/**/*.test.ts'] },
});
