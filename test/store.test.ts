import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MAX_LINE_BYTES } from '../src/core/config.ts';
import { FactoryError } from '../src/core/errors.ts';
import { runId, slugify, ulid } from '../src/store/ids.ts';
import { appendLine, dedupeById, readLines, serialize } from '../src/store/jsonl.ts';
import { loadRun, readRedactValues } from '../src/store/load-run.ts';
import { acquire, claimDir, withLock } from '../src/store/locks.ts';
import { commandsFile, factsFile, lockDir, redactFile } from '../src/store/paths.ts';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'factory-test-'));

test('ulid and run ids have the expected shape', () => {
  assert.match(ulid(), /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(ulid(1000) < ulid(2000));
  assert.match(runId('Add login page!'), /^add-login-page-[0-9a-hjkmnp-tv-z]{4}$/);
  assert.equal(slugify('***'), 'run');
});

test('appendLine writes one line per event and readLines returns them with the offset', () => {
  const f = join(tmp(), 'a', 'x.jsonl');
  appendLine(f, { id: 1, data: {} });
  appendLine(f, { id: 2, data: {} });
  const r = readLines<{ id: number }>(f);
  assert.deepEqual(r.items.map((x) => x.id), [1, 2]);
  assert.equal(r.offset, readFileSync(f).length);
  appendLine(f, { id: 3, data: {} });
  assert.deepEqual(readLines<{ id: number }>(f, r.offset).items.map((x) => x.id), [3]);
});

test('a torn last line waits; a broken complete line is skipped and reported', () => {
  const f = join(tmp(), 'x.jsonl');
  writeFileSync(f, '{"id":1}\n{bad json}\n{"id":3}\n{"id":4');
  const r = readLines<{ id: number }>(f);
  assert.deepEqual(r.items.map((x) => x.id), [1, 3]);
  assert.equal(r.skipped.length, 1);
  appendFileSync(f, '}\n');
  assert.deepEqual(readLines<{ id: number }>(f, r.offset).items.map((x) => x.id), [4]);
});

test('over-long events are truncated to fit, longest field first', () => {
  const line = serialize({ data: { short: 'keep', long: 'x'.repeat(MAX_LINE_BYTES * 2) } });
  assert.ok(Buffer.byteLength(line) < MAX_LINE_BYTES);
  const back = JSON.parse(line);
  assert.equal(back.data.short, 'keep');
  assert.match(back.data.long, /…\[truncated\]$/);
});

test('dedupeById keeps the first occurrence', () => {
  assert.deepEqual(dedupeById([{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'a', n: 3 }]).map((x) => x.n), [1, 2]);
});

test('claimDir is an atomic claim', () => {
  const d = join(tmp(), 'claims', 'S1');
  assert.equal(claimDir(d), true);
  assert.equal(claimDir(d), false);
});

test('a held lock makes a second acquirer wait, then fail with LOCKED', async () => {
  const d = join(tmp(), 'lock');
  const release = await acquire(d);
  await assert.rejects(acquire(d, 100), (e: unknown) => e instanceof FactoryError && e.code === 'LOCKED');
  release();
  assert.equal(existsSync(d), false);
  assert.equal(await withLock(d, () => 42), 42);
});

test('a lock left by a dead process is broken by renaming it aside', async () => {
  const root = tmp();
  const d = join(root, 'lock');
  const dead = spawnSync(process.execPath, ['-e', '0']).pid!;
  mkdirSync(d);
  writeFileSync(join(d, 'owner.json'), JSON.stringify({ pid: dead, host: hostname(), ts: 'then' }));
  const release = await acquire(d, 500);
  assert.ok(readdirSync(root).some((n) => n.startsWith('lock.stale-')));
  release();
});

test('loadRun folds commands in file order and orders facts by (ts, id)', () => {
  process.env.FACTORY_HOME = tmp();
  const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'happy-path.jsonl'), 'utf8');
  const lines = fixture.trim().split('\n');
  const cfile = commandsFile('abc123def456', 'add-login-page-q7k2');
  mkdirSync(join(cfile, '..'), { recursive: true });
  writeFileSync(cfile, lines.join('\n') + '\n' + lines[3] + '\n'); // a duplicate line is ignored
  const fact = (id: string, ts: string) => ({ v: 1, id, ts, run: 'add-login-page-q7k2', session: 's', kind: 'tool_succeeded', actor: 'hook', corr: null, data: { tool_name: 'Bash' } });
  appendLine(factsFile('abc123def456', 'add-login-page-q7k2', 's', null), fact('01JQ00000000000000000000F2', '2026-10-24T09:00:05.000Z'));
  appendLine(factsFile('abc123def456', 'add-login-page-q7k2', 's', 'agent-1'), fact('01JQ00000000000000000000F1', '2026-10-24T09:00:05.000Z'));
  appendLine(factsFile('abc123def456', 'add-login-page-q7k2', 's', 'agent-1'), fact('01JQ00000000000000000000F0', '2026-10-24T09:00:01.000Z'));
  const run = loadRun('abc123def456', 'add-login-page-q7k2');
  assert.equal(run.state.phase, 'COMPLETED');
  assert.equal(run.commands.length, lines.length);
  assert.deepEqual(run.facts.map((f) => f.id), ['01JQ00000000000000000000F0', '01JQ00000000000000000000F1', '01JQ00000000000000000000F2']);
  assert.equal(lockDir('h', 'r').endsWith(join('h', 'runs', 'r', 'lock')), true);
  delete process.env.FACTORY_HOME;
});

test('loadRun skips and reports commands and facts that fail validation', () => {
  process.env.FACTORY_HOME = tmp();
  const [h, r] = ['abc123def456', 'add-login-page-q7k2'];
  const lines = readFileSync(join(import.meta.dirname, 'fixtures', 'happy-path.jsonl'), 'utf8').trim().split('\n');
  const noData = JSON.parse(lines[2]);
  delete noData.data;
  noData.id = '01JQ00000000000000000000M1';
  const unknownKind = { ...JSON.parse(lines[3]), id: '01JQ00000000000000000000M2', kind: 'made_up' };
  const cfile = commandsFile(h, r);
  mkdirSync(join(cfile, '..'), { recursive: true });
  const good = { v: 1, id: '01JQ00000000000000000000F0', ts: '2026-10-24T09:00:01.000Z', run: r, session: 's', kind: 'tool_succeeded', actor: 'hook', corr: null, data: { tool_name: 'Bash' } };
  const factInCommands = { ...good, id: '01JQ00000000000000000000F9' };
  writeFileSync(cfile, [...lines.slice(0, 2), JSON.stringify(noData), JSON.stringify(unknownKind), JSON.stringify(factInCommands), ...lines.slice(2)].join('\n') + '\n');
  const ffile = factsFile(h, r, 's', null);
  appendLine(ffile, good);
  appendLine(ffile, { ...good, id: '01JQ00000000000000000000F1', corr: 'x' }); // facts carry corr null
  appendLine(ffile, { ...good, id: '01JQ00000000000000000000F2', data: {} }); // no tool_name
  appendLine(ffile, JSON.parse(lines[3])); // a valid command in a facts file
  const run = loadRun(h, r);
  assert.equal(run.state.phase, 'COMPLETED');
  assert.deepEqual(run.state.rejected, []);
  assert.equal(run.commands.length, lines.length);
  assert.deepEqual(run.facts.map((f) => f.id), [good.id]);
  assert.deepEqual(run.skipped.map((s) => s.file), [cfile, cfile, cfile, ffile, ffile, ffile]);
  assert.match(run.skipped[0].error, /data must be an object/);
  assert.match(run.skipped[1].error, /unknown kind "made_up"/);
  assert.equal(run.skipped[2].error, 'tool_succeeded is not a command');
  assert.match(run.skipped[3].error, /corr/);
  assert.match(run.skipped[4].error, /tool_name/);
  assert.match(run.skipped[5].error, /is not a fact$/);
  const bytes = readFileSync(cfile);
  assert.equal(JSON.parse(bytes.subarray(run.skipped[0].offset, bytes.indexOf(0x0a, run.skipped[0].offset)).toString()).id, noData.id);
  delete process.env.FACTORY_HOME;
});

test('readRedactValues reads the array or {values} form and ignores everything else', () => {
  process.env.FACTORY_HOME = tmp();
  const [h, r] = ['abc123def456', 'add-login-page-q7k2'];
  const f = redactFile(h, r);
  assert.deepEqual(readRedactValues(h, r), [], 'missing file');
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, JSON.stringify(['a-secret', '', 7, null, 'b-secret']));
  assert.deepEqual(readRedactValues(h, r), ['a-secret', 'b-secret']);
  writeFileSync(f, JSON.stringify({ values: ['c-secret', { x: 1 }, 'd-secret'] }));
  assert.deepEqual(readRedactValues(h, r), ['c-secret', 'd-secret']);
  writeFileSync(f, JSON.stringify({ values: 'nope' }));
  assert.deepEqual(readRedactValues(h, r), []);
  writeFileSync(f, '{ not json');
  assert.deepEqual(readRedactValues(h, r), [], 'malformed JSON');
  delete process.env.FACTORY_HOME;
});
