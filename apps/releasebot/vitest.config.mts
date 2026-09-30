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
					TELEGRAM_BOT_INFO: JSON.stringify({ id: 123456, is_bot: true, first_name: 'ReleaseBot', username: 'release_test_bot' }),
					TELEGRAM_WEBHOOK_SECRET_TOKEN: 'test-webhook-secret',
					GITHUB_TOKEN: 'test-github-token',
					RELEASEBOT_SHARED_SECRET: 'test-build-secret',
				},
			},
		}),
	],
	test: { name: 'releasebot', include: ['test/**/*.test.ts', 'test/**/*.spec.ts'] },
});
