import { defineConfig } from 'vitest/config';

export default defineConfig({
	root: import.meta.dirname,
	test: { name: 'telegram-worker', include: ['test/**/*.test.ts'] },
});
