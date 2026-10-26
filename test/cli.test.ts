import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { NODE_FLOOR } from '../src/core/config.ts';
import { FactoryError } from '../src/core/errors.ts';
import type { Args } from '../src/cli/args.ts';
import { mergeSettings, settingsWarnings, setup } from '../src/cli/setup.ts';

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

test('setup warns (and changes nothing for it) when the sandbox is on without sandbox.network.allowLocalBinding', () => {
  assert.deepEqual(settingsWarnings({}, '/s.json'), []);
  assert.deepEqual(settingsWarnings({ sandbox: { enabled: false } }, '/s.json'), []);
  assert.deepEqual(settingsWarnings({ sandbox: { enabled: true, network: { allowLocalBinding: true } } }, '/s.json'), []);
  const [w] = settingsWarnings({ sandbox: { enabled: true, network: { allowLocalBinding: false } } }, '/s.json');
  assert.match(w, /sandbox\.network\.allowLocalBinding is not true[\s\S]*listen EPERM[\s\S]*\/s\.json/);
  // Through the shim: the warning is in the output, and the merge leaves sandbox.network alone.
  const home = mkdtempSync(join(tmpdir(), 'factory-home-'));
  const settings = join(mkdtempSync(join(tmpdir(), 'claude-')), 'settings.json');
  writeFileSync(settings, JSON.stringify({ sandbox: { enabled: true } }));
  const r = run(['setup'], { FACTORY_HOME: join(home, '.factory'), FACTORY_CLAUDE_SETTINGS: settings });
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.equal(r.out.warnings.length, 1);
  assert.match(r.out.warnings[0], /sandbox\.network\.allowLocalBinding/);
  assert.equal(JSON.parse(readFileSync(settings, 'utf8')).sandbox.network, undefined);
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
  assert.deepEqual(a.out.warnings, []);
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

// 6-3 (AD-23): the artifact embed. Its body is redacted with the run's values, then cut to
// ARTIFACT_EMBED_MAX bytes on a UTF-8 boundary; its sha256 is the reported one, or there is no embed;
// and the step_verified carrying the largest body still fits one line.
test('artifactData: redacted, capped on a UTF-8 boundary, pinned to the reported sha256; its event fits MAX_LINE_BYTES', async () => {
  const { ARTIFACT_EMBED_MAX, MAX_LINE_BYTES } = await import('../src/core/config.ts');
  const { artifactData, capUtf8, verifiedEvent } = await import('../src/cli/steps.ts');
  const { serialize } = await import('../src/store/jsonl.ts');
  const { redactFile } = await import('../src/store/paths.ts');
  const { createHash } = await import('node:crypto');
  const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
  const home = mkdtempSync(join(tmpdir(), 'factory-embed-'));
  const prev = process.env.FACTORY_HOME;
  process.env.FACTORY_HOME = home;
  try {
    const c = { hash: 'aaaaaaaaaaaa', runId: 'r-embed', session: 's', root: home };
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(redactFile(c.hash, c.runId), '..'), { recursive: true });
    writeFileSync(redactFile(c.hash, c.runId), JSON.stringify({ values: ['hunter2-is-the-secret'] }));

    // Secret in spec: [REDACTED] in the body, the sha256 the step reported (of the raw bytes).
    const spec = 'STATUS: DONE\n# Footer\nAPI_TOKEN=hunter2-is-the-secret\n';
    assert.deepEqual(artifactData(c, '/h/out.md', spec, sha(spec)), { path: '/h/out.md', sha256: sha(spec), body: 'STATUS: DONE\n# Footer\nAPI_TOKEN=[REDACTED]\n', truncated: false });
    assert.equal(artifactData(c, '/h/out.md', spec, sha('other bytes')), undefined, 'the file changed since it was reported: no embed');
    assert.equal(artifactData(c, '/h/out.md', null, sha(spec)), undefined, 'no file: no embed');

    // UTF-8 boundary: a 3-byte character is never split.
    assert.deepEqual(capUtf8('ab€cd', 4), { text: 'ab', truncated: true });
    assert.deepEqual(capUtf8('ab€cd', 5), { text: 'ab€', truncated: true });
    assert.deepEqual(capUtf8('ab€cd', 7), { text: 'ab€cd', truncated: false });

    // Over cap: quotes, newlines and multi-byte text past ARTIFACT_EMBED_MAX.
    const big = `STATUS: DONE\n${'"quoted" line — ünïcödé\n'.repeat(4000)}`;
    assert.ok(Buffer.byteLength(big) > ARTIFACT_EMBED_MAX);
    const a = artifactData(c, '/h/out.md', big, sha(big))!;
    assert.equal(a.truncated, true);
    assert.ok(Buffer.byteLength(a.body) <= ARTIFACT_EMBED_MAX && Buffer.byteLength(a.body) > ARTIFACT_EMBED_MAX - 4);
    assert.ok(big.startsWith(a.body));
    const st = { id: '01JQ0000000000000000000001', kind: 'spawn', stage: 'SPEC', attempt: 1, state: 'reported', role: 'spec-writer', output_path: '/h/out.md', output: { sha256: sha(big) }, issued_seq: 1 } as const;
    const e = verifiedEvent(c, st as never, ['f1', 'f2'], 'DONE', { path: '/h/out.md', real: '/h/out.md', text: big, sha256: sha(big), result: { ok: false, error: 'unused' } } as never);
    const line = serialize(e);
    assert.ok(Buffer.byteLength(line) + 1 <= MAX_LINE_BYTES, `${Buffer.byteLength(line)} bytes`);
    assert.deepEqual(JSON.parse(line).data.artifact, a, 'the body fits without the line cap cutting it');
    // The file changed after the report: the re-read bytes no longer hash to the reported sha256.
    const changed = 'STATUS: DONE\n# edited after the report\n';
    const stale = verifiedEvent(c, st as never, [], 'DONE', { path: '/h/out.md', real: '/h/out.md', text: changed, sha256: sha(changed), result: { ok: false, error: 'unused' } } as never);
    assert.equal((stale.data as { artifact?: unknown }).artifact, undefined);
    // A step with no reported sha256 embeds nothing either.
    const unreported = verifiedEvent(c, { ...st, output: {} } as never, [], 'DONE', { path: '/h/out.md', real: '/h/out.md', text: big, sha256: sha(big), result: { ok: false, error: 'unused' } } as never);
    assert.equal((unreported.data as { artifact?: unknown }).artifact, undefined);
    // Other roles embed nothing.
    assert.equal((verifiedEvent(c, { ...st, role: 'builder' } as never, [], 'DONE', { path: '/h/out.md', text: big, sha256: sha(big) } as never).data as { artifact?: unknown }).artifact, undefined);
  } finally {
    if (prev === undefined) delete process.env.FACTORY_HOME; else process.env.FACTORY_HOME = prev;
  }
});

// --- check timeouts (sh) -------------------------------------------------------------------------

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('sh: a command that hits the timeout fails with 124 and "timed out", even when sh exits 0 while a grandchild holds stdout', async () => {
  const { sh } = await import('../src/cli/check.ts');
  const cache = mkdtempSync(join(tmpdir(), 'factory-sh-'));
  const r = sh('sleep 8 & echo started', cache, undefined, 500, join(cache, 'c'));
  assert.equal(r.code, 124, r.log);
  assert.match(r.log, /^started$/m);
  assert.match(r.log, /timed out after 500 ms\n\[exit 124\]\n$/);
  // A command that ends in time keeps its own status.
  assert.equal(sh('exit 3', cache, undefined, 5_000, join(cache, 'c')).code, 3);
  assert.equal(sh('true', cache, undefined, 5_000, join(cache, 'c')).code, 0);
});

test('sh: the timeout kills the whole process group, so a backgrounded grandchild does not outlive the check', async () => {
  const { sh } = await import('../src/cli/check.ts');
  const cache = mkdtempSync(join(tmpdir(), 'factory-sh-'));
  const r = sh('sleep 7.77 & echo $!', cache, undefined, 500, join(cache, 'c'));
  assert.equal(r.code, 124, r.log);
  const pid = Number(/^(\d+)$/m.exec(r.log)?.[1]);
  assert.ok(pid > 0, r.log);
  // SIGKILL lands asynchronously: give the orphan a moment to be reaped.
  const until = Date.now() + 2_000;
  while (alive(pid) && Date.now() < until) await new Promise((res) => setTimeout(res, 20));
  assert.equal(alive(pid), false, `sleep ${pid} is still running`);
});
