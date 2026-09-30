import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let fixture;
let script;

beforeEach(() => {
	fixture = mkdtempSync(join(tmpdir(), 'telegram-bots-'));
	mkdirSync(join(fixture, 'apps'));
	mkdirSync(join(fixture, 'scripts'));
	cpSync(resolve(import.meta.dirname, '../../templates'), join(fixture, 'templates'), { recursive: true });
	script = join(fixture, 'scripts/create-bot.mjs');
	cpSync(resolve(import.meta.dirname, '../create-bot.mjs'), script);
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

describe('create bot', () => {
	it('creates independent applications from the template', () => {
		for (const name of ['echo-bot', 'support-bot']) {
			execFileSync(process.execPath, [script, name]);
			const directory = join(fixture, 'apps', name);
			const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
			expect(pkg.name).toBe('@bots/' + name);
			expect(pkg.dependencies['@bots/telegram-worker']).toBe('0.0.1');
			expect(readFileSync(join(directory, 'wrangler.jsonc'), 'utf8')).toContain('"name": "' + name + '"');
			expect(readFileSync(join(directory, 'src/bot.ts'), 'utf8')).toContain(name);
			expect(readFileSync(join(directory, 'vitest.config.mts'), 'utf8')).not.toContain('__BOT_NAME__');
		}
	});

	it('refuses to overwrite a bot', () => {
		execFileSync(process.execPath, [script, 'echo-bot']);
		const path = join(fixture, 'apps/echo-bot/package.json');
		const contents = readFileSync(path, 'utf8');
		expect(spawnSync(process.execPath, [script, 'echo-bot']).status).toBe(1);
		expect(readFileSync(path, 'utf8')).toBe(contents);
	});

	it.each(['../outside', 'Bot', 'with space', '-bot', 'bot--name', 'a'.repeat(64)])('rejects invalid name %s', (name) => {
		expect(spawnSync(process.execPath, [script, name]).status).toBe(1);
	});
});
