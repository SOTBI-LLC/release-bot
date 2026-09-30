import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const app of readdirSync(join(root, 'apps'), { withFileTypes: true })) {
	if (!app.isDirectory()) continue;
	const result = spawnSync('yarn', ['deploy:check'], { cwd: join(root, 'apps', app.name), stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
