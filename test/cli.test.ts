import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { NODE_FLOOR } from '../src/core/config.ts';
import { FactoryError } from '../src/core/errors.ts';
import type { Args } from '../src/cli/args.ts';
import { mergeSettings, setup } from '../src/cli/setup.ts';

const ROOT = join(import.meta.dirname, '..');
const BIN = join(ROOT, 'bin', 'factory');

function run(args: string[], env: Record<string, string>): { code: number | null; out: any } {
  const r = spawnSync(BIN, args, { env: { ...process.env, ...env }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : r.stderr };
}

test('bootstrap repeats the Node floor from config', () => {
  assert.match(readFileSync(join(ROOT, 'src', 'cli', 'bootstrap.mjs'), 'utf8'), new RegExp(`const FLOOR = '${NODE_FLOOR}'`));
});

test('mergeSettings adds the factory entries once and keeps existing ones', () => {
  const s: any = { theme: 'dark', permissions: { allow: ['Read'], defaultMode: 'default' } };
  const first = mergeSettings(s, '/h/.factory');
  assert.deepEqual(first, [
    'permissions.additionalDirectories += /h/.factory',
    'permissions.allow += EnterWorktree',
    'permissions.allow += Bash(factory:*)',
  ]);
  assert.deepEqual(s.permissions.allow, ['Read', 'EnterWorktree', 'Bash(factory:*)']);
  assert.equal(s.theme, 'dark');
  assert.deepEqual(mergeSettings(s, '/h/.factory'), []);
});

test('mergeSettings adds the sandbox write rule only when a sandbox is enabled, and treats ~ as home', () => {
  const off: any = {};
  mergeSettings(off, '/h/.factory');
  assert.equal(off.sandbox, undefined);
  const on: any = { sandbox: { enabled: true } };
  assert.ok(mergeSettings(on, '/h/.factory').includes('sandbox.filesystem.allowWrite += /h/.factory'));
  const tilde: any = { sandbox: { enabled: true, filesystem: { allowWrite: ['~/.factory'] } }, permissions: { additionalDirectories: ['~/.factory'], allow: ['EnterWorktree', 'Bash(factory:*)'] } };
  const home = process.env.HOME + '/.factory';
  assert.deepEqual(mergeSettings(tilde, home), []);
});

test('mergeSettings refuses to overwrite a field of the wrong type', () => {
  assert.throws(() => mergeSettings({ permissions: { allow: 'Read' } }, '/h'), (e: unknown) => e instanceof FactoryError && e.code === 'SETUP_FAILED');
});

test('factory setup through the shim is idempotent and backs up settings once', () => {
  const home = mkdtempSync(join(tmpdir(), 'factory-home-'));
  const settings = join(mkdtempSync(join(tmpdir(), 'claude-')), 'settings.json');
  writeFileSync(settings, JSON.stringify({ theme: 'auto' }));
  const env = { FACTORY_HOME: join(home, '.factory'), FACTORY_CLAUDE_SETTINGS: settings };
  const a = run(['setup'], env);
  assert.equal(a.code, 0, JSON.stringify(a.out));
  assert.equal(a.out.settings_changed.length, 3);
  assert.equal(readlinkSync(join(home, '.factory', 'node')), process.execPath);
  assert.ok(existsSync(settings + '.before-factory'));
  const b = run(['setup'], env);
  assert.equal(b.code, 0);
  assert.deepEqual(b.out.settings_changed, []);
  assert.equal(b.out.node_changed, false);
  const saved = JSON.parse(readFileSync(settings, 'utf8'));
  assert.equal(saved.theme, 'auto');
  assert.deepEqual(JSON.parse(readFileSync(settings + '.before-factory', 'utf8')), { theme: 'auto' });
});

test('unknown verbs fail with BAD_ARGS as JSON on stdout, prototype names included', () => {
  for (const verb of ['frobnicate', 'constructor', '__proto__', 'toString']) {
    const r = run([verb], { FACTORY_HOME: mkdtempSync(join(tmpdir(), 'fh-')) });
    assert.equal(r.code, 1);
    assert.equal(r.out.error.code, 'BAD_ARGS');
    assert.match(r.out.error.message, /unknown verb/);
  }
});

test('a failed rename onto settings.json removes the tmp file and leaves settings untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-'));
  const settings = join(dir, 'settings.json');
  writeFileSync(settings, JSON.stringify({ theme: 'auto' }));
  const saved = { home: process.env.FACTORY_HOME, settings: process.env.FACTORY_CLAUDE_SETTINGS };
  process.env.FACTORY_HOME = join(mkdtempSync(join(tmpdir(), 'fh-')), '.factory');
  process.env.FACTORY_CLAUDE_SETTINGS = settings;
  let renamed = '';
  try {
    assert.throws(() => setup({} as Args, (from) => {
      renamed = String(from);
      throw Object.assign(new Error('rename refused'), { code: 'EPERM' });
    }), (e: unknown) => e instanceof FactoryError && e.code === 'SETUP_FAILED' && /\(EPERM\)/.test(e.message));
  } finally {
    for (const [k, v] of [['FACTORY_HOME', saved.home], ['FACTORY_CLAUDE_SETTINGS', saved.settings]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
  assert.match(renamed, /settings\.json\.factory-\d+\.tmp$/, 'the tmp file was written and only its rename failed');
  assert.equal(readFileSync(settings, 'utf8'), JSON.stringify({ theme: 'auto' }));
  assert.deepEqual(readdirSync(dir).sort(), ['settings.json', 'settings.json.before-factory']); // the tmp file is gone
});

test('settings that are not valid JSON are left alone', () => {
  const settings = join(mkdtempSync(join(tmpdir(), 'claude-')), 'settings.json');
  writeFileSync(settings, '{ nope');
  const r = run(['setup'], { FACTORY_HOME: join(mkdtempSync(join(tmpdir(), 'fh-')), '.factory'), FACTORY_CLAUDE_SETTINGS: settings });
  assert.equal(r.out.error.code, 'SETUP_FAILED');
  assert.equal(readFileSync(settings, 'utf8'), '{ nope');
});

test('a settings file that cannot be written fails with SETUP_FAILED and stays untouched', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-'));
  const settings = join(dir, 'settings.json');
  writeFileSync(settings, JSON.stringify({ theme: 'auto' }));
  chmodSync(dir, 0o555);
  try {
    const r = run(['setup'], { FACTORY_HOME: join(mkdtempSync(join(tmpdir(), 'fh-')), '.factory'), FACTORY_CLAUDE_SETTINGS: settings });
    assert.equal(r.code, 1);
    assert.equal(r.out.error.code, 'SETUP_FAILED');
    assert.match(r.out.error.message, /run factory setup in your own terminal/);
    assert.equal(readFileSync(settings, 'utf8'), JSON.stringify({ theme: 'auto' }));
    assert.deepEqual(readdirSync(dir), ['settings.json']); // no tmp file, no backup left behind
  } finally {
    chmodSync(dir, 0o755);
  }
});
