// `factory record` (AD-18): writeRecording on a hand-made run under a temp FACTORY_HOME.
import { strict as assert } from 'node:assert';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FactoryError } from '../src/core/errors.ts';
import { ulid } from '../src/store/ids.ts';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-rec-')));
process.env.FACTORY_HOME = join(base, '.factory');
process.env.FACTORY_CLAUDE_PROJECTS = join(base, 'projects');
const { writeRecording } = await import('../src/cli/record.ts');

const HASH = 'abcdef012345';
const RUN = 'add-x-ab12';
const EXTRA = 'tok-from-dotenv-123'; // a redact.json value
const KEY = 'sk-abcdefghijklmnopqrstuvwxyz0123'; // a secret pattern
const runDir = join(base, '.factory', HASH, 'runs', RUN);
const line = (o: object): string => JSON.stringify(o) + '\n';
const cmd = (kind: string, data: object, extra: object = {}) => line({ v: 1, id: ulid(), ts: new Date().toISOString(), run: RUN, kind, actor: 'cli', corr: '', data, ...extra });
const fact = (session: string, kind: string, data: object) => line({ v: 1, id: ulid(), ts: new Date().toISOString(), run: RUN, session, kind, actor: 'hook', corr: null, data });

function put(file: string, data: string | Buffer): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, data);
}

const agentT = join(base, 'projects', '-p', 's1', 'subagents', 'agent-a1.jsonl');
put(join(runDir, 'commands.jsonl'), cmd('run_started', { task: `use ${KEY}`, repo_hash: HASH, base_sha: 'b', branch: `factory/${RUN}` }) + cmd('session_bound', { session: 's1' }) + '{"torn":');
put(join(runDir, 'facts', 's1-main.jsonl'), fact('s1', 'tool_succeeded', { tool_name: 'Bash', command: `echo ${EXTRA}` }));
put(join(runDir, 'facts', 's1-a1.jsonl'), fact('s1', 'subagent_stopped', { agent_id: 'a1', agent_transcript_path: agentT }) + fact('s1', 'subagent_stopped', { agent_id: 'a2', agent_transcript_path: '/etc/hosts' }));
put(join(runDir, 'facts', 's9-a3.jsonl'), fact('s9', 'subagent_stopped', { agent_id: 'a3', agent_transcript_path: agentT }));
put(join(runDir, 'artifacts', 'steps', 'X', 'out.md'), `STATUS: DONE\nAPI=${EXTRA}\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nsecretbody\n-----END RSA PRIVATE KEY-----\n`);
put(join(runDir, 'artifacts', 'steps', 'X', 'shot.png'), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
put(join(runDir, 'artifacts', 'steps', 'X', 'dump.bin'), Buffer.concat([Buffer.from([0]), Buffer.from(`key=${EXTRA}`)])); // a NUL, but no image
put(join(base, 'outside.txt'), `outside ${EXTRA}\n`);
symlinkSync(join(base, 'outside.txt'), join(runDir, 'artifacts', 'steps', 'X', 'link.md'));
put(join(runDir, 'redact.json'), JSON.stringify({ values: [EXTRA] }));
put(join(runDir, 'lock', 'owner.json'), '{}');
put(join(runDir, 'devserver.pid'), '{}');
put(join(runDir, 'devserver.log'), `server ${EXTRA}`);
put(join(base, 'projects', '-p', 's1.jsonl'), line({ type: 'user', message: { content: `my key is ${KEY}` } }) + line({ type: 'assistant', message: { content: [{ type: 'text', text: `"quoted ${EXTRA}"` }] } }));
put(agentT, line({ type: 'assistant', message: { content: `agent saw ${EXTRA}` } }));

test('record: manifest, the run tree (commands, facts, artifacts only), bound sessions\' transcripts and agent transcripts under the projects dir; every line redacted', () => {
  const out = writeRecording('demo', [{ hash: HASH, runId: RUN }]);
  const rec = join(base, '.factory', 'recordings', 'demo');
  assert.equal(out.path, rec);
  const m = JSON.parse(readFileSync(join(rec, 'manifest.json'), 'utf8'));
  assert.deepEqual({ v: m.v, name: m.name, plugin_version: m.plugin_version, runs: m.runs }, { v: 1, name: 'demo', plugin_version: '0.1.0', runs: [{ repo_hash: HASH, run_id: RUN }] });
  assert.match(m.recorded_at, /^\d{4}-\d{2}-\d{2}T/);
  const files = (readdirSync(rec, { recursive: true }) as string[]).filter((f) => lstatSync(join(rec, f)).isFile()).sort();
  const r = join('runs', HASH, RUN);
  assert.deepEqual(files, [
    'manifest.json', join(r, 'artifacts', 'steps', 'X', 'dump.bin'), join(r, 'artifacts', 'steps', 'X', 'out.md'), join(r, 'artifacts', 'steps', 'X', 'shot.png'), join(r, 'commands.jsonl'),
    join(r, 'facts', 's1-a1.jsonl'), join(r, 'facts', 's1-main.jsonl'), join(r, 'facts', 's9-a3.jsonl'),
    join('transcripts', 's1-a1.jsonl'), join('transcripts', 's1.jsonl'),
  ].sort(), 'no redact.json, lock or devserver files, no symlink; no transcript outside the projects dir or of an unbound session');
  for (const f of files.filter((x) => !x.endsWith('.png'))) {
    const text = readFileSync(join(rec, f), 'utf8');
    for (const s of [EXTRA, KEY, 'secretbody']) assert.ok(!text.includes(s), `${f} has ${s}`);
  }
  const cmds = readFileSync(join(rec, r, 'commands.jsonl'), 'utf8');
  assert.equal(cmds.trim().split('\n').length, 2, 'the torn line is left out');
  assert.equal(JSON.parse(cmds.split('\n')[0]).data.task, 'use [REDACTED]');
  assert.match(readFileSync(join(rec, 'transcripts', 's1.jsonl'), 'utf8'), /quoted \[REDACTED\]/);
  assert.deepEqual(readFileSync(join(rec, r, 'artifacts', 'steps', 'X', 'shot.png')), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
  assert.deepEqual(out.transcripts, ['s1', 's1-a1']);
  assert.match(readFileSync(join(rec, r, 'artifacts', 'steps', 'X', 'dump.bin'), 'utf8'), /key=\[REDACTED\]/, 'only images are copied unredacted');
});

test('record: with several runs, every file and transcript is redacted with the union of their values', () => {
  const RUN2 = 'add-y-cd34';
  const EXTRA2 = 'second-run-secret-456';
  const dir2 = join(base, '.factory', HASH, 'runs', RUN2);
  const cmd2 = (kind: string, data: object) => line({ v: 1, id: ulid(), ts: new Date().toISOString(), run: RUN2, kind, actor: 'cli', corr: '', data });
  put(join(dir2, 'commands.jsonl'), cmd2('run_started', { task: 'y', repo_hash: HASH, base_sha: 'b', branch: `factory/${RUN2}` }) + cmd2('session_bound', { session: 's1' }));
  put(join(dir2, 'artifacts', 'steps', 'Y', 'out.md'), `uses ${EXTRA}\n`);
  put(join(dir2, 'redact.json'), JSON.stringify([EXTRA2]));
  put(join(base, 'projects', '-p', 's1.jsonl'), line({ type: 'user', message: { content: `first ${EXTRA} then ${EXTRA2}` } }));
  const out = writeRecording('both', [{ hash: HASH, runId: RUN }, { hash: HASH, runId: RUN2 }]);
  assert.deepEqual(out.runs.map((x) => x.run_id), [RUN, RUN2]);
  assert.equal(readFileSync(join(out.path, 'transcripts', 's1.jsonl'), 'utf8').trim(), line({ type: 'user', message: { content: 'first [REDACTED] then [REDACTED]' } }).trim());
  assert.equal(readFileSync(join(out.path, 'runs', HASH, RUN2, 'artifacts', 'steps', 'Y', 'out.md'), 'utf8'), 'uses [REDACTED]\n', "run 1's value in run 2's tree");
});

test('record: a taken name is CLAIM_TAKEN; a bad name or an unknown run is refused and leaves nothing', () => {
  const code = (f: () => unknown): string => { try { f(); } catch (e) { return (e as FactoryError).code; } return 'none'; };
  writeRecording('twice', [{ hash: HASH, runId: RUN }]);
  assert.equal(code(() => writeRecording('twice', [{ hash: HASH, runId: RUN }])), 'CLAIM_TAKEN');
  assert.equal(code(() => writeRecording('../up', [{ hash: HASH, runId: RUN }])), 'BAD_ARGS');
  assert.equal(code(() => writeRecording('ghost', [{ hash: HASH, runId: 'nope-0000' }])), 'NOT_FOUND');
  assert.equal(existsSync(join(base, '.factory', 'recordings', 'ghost')), false);
});
