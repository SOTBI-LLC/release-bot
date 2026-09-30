import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	root: import.meta.dirname,
	plugins: [cloudflareTest({
		wrangler: { configPath: `${import.meta.dirname}/wrangler.jsonc` },
		miniflare: { bindings: {
			TELEGRAM_BOT_TOKEN: '123456:test-token',
			TELEGRAM_CHAT_ID: '-1001234567890',
			GRAFANA_WEBHOOK_SECRET: 'grafana-test-secret',
			DELIVERY_ADMIN_SECRET: 'admin-test-secret',
		} },
	})],
	test: { name: 'alertbot', include: ['test/**/*.test.ts'] },
});
