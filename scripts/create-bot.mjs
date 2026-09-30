import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [name, ...extra] = process.argv.slice(2);

if (!name || extra.length || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 63) {
	console.error('Usage: yarn bot:create <name> (lowercase letters, numbers and hyphens, up to 63 characters)');
	process.exit(1);
}

const destination = join(root, 'apps', name);
try {
	// mkdir without recursive prevents overwriting an existing bot.
	await mkdir(destination);
} catch (error) {
	if (error.code !== 'EEXIST') throw error;
	console.error(`Bot already exists: apps/${name}`);
	process.exit(1);
}

await cp(join(root, 'templates', 'telegram-bot'), destination, { recursive: true });

async function replacePlaceholders(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			await replacePlaceholders(path);
		} else {
			const contents = await readFile(path, 'utf8');
			await writeFile(path, contents.replaceAll('__BOT_NAME__', name));
		}
	}
}

await replacePlaceholders(destination);
console.log(`Created apps/${name}. Next steps:\n  yarn install\n  yarn workspace @bots/${name} cf-typegen\n  cp apps/${name}/.dev.vars.example apps/${name}/.dev.vars\n  yarn workspace @bots/${name} dev`);
