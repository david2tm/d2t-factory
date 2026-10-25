// End-to-end tests of the 1-3 hooks: payload JSON piped into `bin/factory hook <Event>` with a temp
// FACTORY_HOME, next to the real CLI. Transcript turns use Claude Code's real plugin-command format.
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { NODE_FLOOR } from '../src/core/config.ts';
import { validateEvent } from '../src/core/events.ts';
import { REDACTED } from '../src/core/redact.ts';
import { ulid } from '../src/store/ids.ts';
import { appendLine, readLines } from '../src/store/jsonl.ts';
import { intakeOut, recordIntake } from './harness.ts';

const ROOT = join(import.meta.dirname, '..');
const BIN = join(ROOT, 'bin', 'factory');
const CMD = 'd2t-factory:factory';

interface World { base: string; home: string; projects: string; repo: string; sock: string; env: Record<string, string> }

// The Claude process stand-in: this test's own pid (so a `ps` fallback would also work) and a
// `<pid>.sock` file whose birthtime is the start key.
function world(): World {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-hooks-')));
  const home = join(base, '.factory');
  mkdirSync(home);
  symlinkSync(process.execPath, join(home, 'node'));
  const projects = join(base, 'projects');
  mkdirSync(join(projects, '-repo'), { recursive: true });
  const agents = join(base, 'agents.json');
  writeFileSync(agents, '[]');
  const sock = join(base, 'socks', `${process.pid}.sock`);
  mkdirSync(join(base, 'socks'));
  writeFileSync(sock, '');
  const repo = join(base, 'repo');
  mkdirSync(repo);
  const g = (...a: string[]): void => { execFileSync('git', a, { cwd: repo, stdio: 'ignore' }); };
  g('init', '-q');
  // One tracked file: a repo whose HEAD tree is empty would be a greenfield run (5-2).
  writeFileSync(join(repo, 'README.md'), '# demo\n');
  g('add', 'README.md');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
  return {
    base, home, projects, repo, sock,
    env: {
      FACTORY_HOME: home, FACTORY_CLAUDE_PROJECTS: projects, FACTORY_CLAUDE_AGENTS_JSON: agents,
      CLAUDE_PID: String(process.pid), CLAUDE_CODE_MESSAGING_SOCKET: sock, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: join(base, 'data'),
      FACTORY_DASHBOARD_OFF: '1', // start and resume never spawn a dashboard server here
    },
  };
}

function childEnv(w: World, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...w.env };
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_PLUGIN_OPTION_DASHBOARD_PORT']) delete env[k];
  for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete env[k]; else env[k] = v; }
  return env;
}

interface Out { code: number | null; out: any; raw: string }

function hook(w: World, event: string, payload: object | string, env: Record<string, string | undefined> = {}): Out {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const r = spawnSync(BIN, ['hook', event], { cwd: w.repo, env: childEnv(w, env), encoding: 'utf8', input });
  assert.equal(r.stderr, '', `stderr from hook ${event}`);
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, raw: r.stdout };
}

function cli(w: World, args: string[], env: Record<string, string | undefined> = {}): Out {
  const r = spawnSync(BIN, args, { cwd: w.repo, env: childEnv(w, env), encoding: 'utf8' });
  let out: any = r.stderr;
  try { out = JSON.parse(r.stdout); } catch { /* keep stderr */ }
  return { code: r.status, out, raw: r.stdout };
}

const ok = (r: Out): any => { assert.equal(r.code, 0, JSON.stringify(r.out)); return r.out; };
const silent = (r: Out): void => { assert.equal(r.code, 0); assert.equal(r.raw, '', `expected no output, got ${r.raw}`); };
const fails = (r: Out, code: string): void => { assert.equal(r.code, 1, JSON.stringify(r.out)); assert.equal(r.out.error?.code, code, JSON.stringify(r.out)); };

const transcript = (w: World, session: string): string => join(w.projects, '-repo', `${session}.jsonl`);
const base = (w: World, session: string): object => ({ session_id: session, transcript_path: transcript(w, session), cwd: w.repo });
const REAL = (args: string): string => `<command-message>${CMD}</command-message>\n<command-name>/${CMD}</command-name>\n<command-args>${args}</command-args>`;

// A human types `text`: the two prompt hooks fire, then Claude Code writes the transcript turn
// (UserPromptSubmit → UserPromptExpansion → turn, the order observed live).
function type(w: World, session: string, text: string): string {
  const prompt_id = randomUUID();
  silent(hook(w, 'UserPromptSubmit', { ...base(w, session), prompt_id, permission_mode: 'default', hook_event_name: 'UserPromptSubmit', prompt: text }));
  const m = /^\/(?:d2t-factory:)?factory(?:\s+([\s\S]*))?$/.exec(text);
  if (m) {
    const args = (m[1] ?? '').trim();
    silent(hook(w, 'UserPromptExpansion', { ...base(w, session), prompt_id, hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: CMD, command_args: args, command_source: 'plugin', prompt: `/${CMD} ${args}` }));
    appendFileSync(transcript(w, session), JSON.stringify({ type: 'user', promptId: prompt_id, sessionId: session, turnOrigin: 'human', timestamp: new Date().toISOString(), message: { role: 'user', content: REAL(args) } }) + '\n');
  }
  return prompt_id;
}

const sessionStart = (w: World, session: string, source: string, env: Record<string, string | undefined> = {}): Out =>
  hook(w, 'SessionStart', { ...base(w, session), hook_event_name: 'SessionStart', source, model: 'claude-x' }, env);

const inbox = (w: World, session: string): any[] => readLines<any>(join(w.home, 'inbox', `${session}.jsonl`)).items;
const sessionFile = (w: World, s: string): any => { try { return JSON.parse(readFileSync(join(w.home, 'sessions', `${s}.json`), 'utf8')); } catch { return null; } };

function runDir(w: World, runId: string): string {
  const hash = readdirSync(w.home).find((h) => existsSync(join(w.home, h, 'runs', runId)));
  assert.ok(hash, `run ${runId} not found`);
  return join(w.home, hash, 'runs', runId);
}
const commands = (w: World, runId: string): any[] => readLines<any>(join(runDir(w, runId), 'commands.jsonl')).items;
const factFile = (w: World, runId: string, session: string, agent = 'main'): any[] => readLines<any>(join(runDir(w, runId), 'facts', `${session}-${agent}.jsonl`)).items;
function allFacts(w: World, runId: string): any[] {
  const dir = join(runDir(w, runId), 'facts');
  return existsSync(dir) ? readdirSync(dir).flatMap((n) => readLines<any>(join(dir, n)).items) : [];
}

// Boot a session, type a task and start a run. Returns the run id.
function started(w: World, session: string, task = 'add login'): string {
  silent(sessionStart(w, session, 'startup'));
  type(w, session, `/factory ${task}`);
  return ok(cli(w, ['start', '--session', session])).run_id;
}

const valid = (lines: any[]): void => {
  for (const l of lines) { const v = validateEvent(l); assert.ok(v.ok, `${JSON.stringify(l)}: ${v.ok ? '' : v.errors.join('; ')}`); }
};

test('the hooks bootstrap repeats the Node floor and the FACTORY_HOME default', () => {
  const src = readFileSync(join(ROOT, 'src', 'hooks', 'bootstrap.mjs'), 'utf8');
  assert.match(src, new RegExp(`const FLOOR = '${NODE_FLOOR}'`));
  assert.match(src, /process\.env\.FACTORY_HOME \|\| join\(homedir\(\), '\.factory'\)/);
});

test('hooks.json registers exec-form hooks, sync and async per AD-13, with the two matchers', () => {
  const h = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const sync = ['UserPromptSubmit', 'UserPromptExpansion', 'Stop', 'SessionStart', 'PreToolUse'];
  const async = ['SubagentStart', 'SubagentStop', 'PostToolUse', 'PostToolUseFailure', 'SessionEnd'];
  assert.deepEqual(Object.keys(h).sort(), [...sync, ...async].sort());
  for (const ev of [...sync, ...async]) {
    const [entry] = h[ev];
    assert.deepEqual(entry.hooks, [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/bin/factory', args: ['hook', ev], ...(async.includes(ev) ? { async: true } : {}) }]);
  }
  assert.equal(h.UserPromptExpansion[0].matcher, '^d2t-factory:factory$');
  assert.equal(h.PreToolUse[0].matcher, '^(Write|Edit|MultiEdit|NotebookEdit|Bash)$');
  const skill = readFileSync(join(ROOT, 'skills', 'factory', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: factory\n[\s\S]*disable-model-invocation: true\n---\n/);
  assert.match(skill, /factory decide --session \$\{CLAUDE_SESSION_ID\}/);
});

test('no factory home: every hook exits 0 silently and creates nothing', () => {
  const w = world();
  const missing = join(w.base, 'nope');
  for (const ev of ['SessionStart', 'UserPromptSubmit', 'Stop', 'PreToolUse', 'PostToolUse', 'Bogus']) {
    silent(hook(w, ev, { session_id: 's1', source: 'startup', prompt: '/factory x', prompt_id: 'p1' }, { FACTORY_HOME: missing }));
  }
  assert.equal(existsSync(missing), false);
});

test('failures exit 0 with no output and land in hook-errors.log', () => {
  const w = world();
  silent(hook(w, 'Stop', '{not json'));
  silent(hook(w, 'NoSuchEvent', {}));
  const log = readFileSync(join(w.home, 'hook-errors.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.map((l) => l.event), ['Stop', 'NoSuchEvent']);
  assert.match(log[1].error, /unknown hook event/);
});

test('SessionStart writes plugin-env.json for any session, with the port option or 4870', () => {
  const w = world();
  silent(sessionStart(w, 'unbound-1', 'startup'));
  const env = JSON.parse(readFileSync(join(w.home, 'plugin-env.json'), 'utf8'));
  assert.deepEqual({ ...env, written_at: typeof env.written_at }, { v: 1, plugin_root: ROOT, plugin_data: join(w.base, 'data'), dashboard_port: 4870, written_at: 'string' });
  silent(sessionStart(w, 'unbound-1', 'resume', { CLAUDE_PLUGIN_OPTION_DASHBOARD_PORT: '5999' }));
  assert.equal(JSON.parse(readFileSync(join(w.home, 'plugin-env.json'), 'utf8')).dashboard_port, 5999);
  assert.equal(existsSync(join(w.home, 'sessions')), false, 'no binding, no facts for an unbound session');
});

test('capture: /factory and /d2t-factory:factory prompts reach the inbox, bound or not; other prompts write nothing', () => {
  const w = world();
  const p1 = type(w, 's1', '/factory add login');
  const lines = inbox(w, 's1');
  assert.deepEqual(lines.map((l) => [l.kind, l.data.prompt_id]), [['prompt_text', p1], ['human_prompt', p1]]);
  assert.equal(lines[0].data.prompt, '/factory add login');
  assert.deepEqual({ name: lines[1].data.command_name, args: lines[1].data.command_args }, { name: CMD, args: 'add login' });
  for (const l of lines) assert.deepEqual([l.actor, l.corr, l.session, l.run], ['hook', null, 's1', 'inbox']);
  valid(lines);
  type(w, 's1', '/d2t-factory:factory approve intake');
  assert.equal(inbox(w, 's1').at(-2).data.prompt, '/d2t-factory:factory approve intake');
  const before = inbox(w, 's1').length;
  for (const prompt of ['<task-notification>\n<task-id>b1</task-id> done</task-notification>', 'please run /factory', '/factoryx go', ' /factory padded']) {
    silent(hook(w, 'UserPromptSubmit', { ...base(w, 's1'), prompt_id: randomUUID(), prompt }));
  }
  silent(hook(w, 'UserPromptExpansion', { ...base(w, 's1'), prompt_id: randomUUID(), command_name: 'other:factory', command_args: 'approve intake' }));
  silent(hook(w, 'UserPromptSubmit', { session_id: '../escape', prompt_id: 'p', prompt: '/factory x' }));
  assert.equal(inbox(w, 's1').length, before);
  assert.deepEqual(readdirSync(join(w.home, 'inbox')).sort(), ['s1.jsonl']);
});

test('capture → decide round trip with a real-format transcript; secrets are redacted and still verify', () => {
  const w = world();
  const pid = type(w, 's1', '/factory add login with AKIAIOSFODNN7EXAMPLE');
  assert.ok(inbox(w, 's1').every((l) => !JSON.stringify(l).includes('AKIAIOSFODNN7EXAMPLE')));
  const d = ok(cli(w, ['decide', '--session', 's1']));
  assert.deepEqual({ intent: d.intent, task: d.task, prompt_id: d.prompt_id }, { intent: 'start', task: `add login with ${REDACTED}`, prompt_id: pid });
});

test('acceptance: add login → start → /clear rebind → next from the new session → approve intake → ORIENT', () => {
  const w = world();
  rmSync(join(w.home, 'plugin-env.json'), { force: true });
  const s1 = randomUUID();
  const s2 = randomUUID();
  silent(sessionStart(w, s1, 'startup')); // writes plugin-env.json, which start requires
  type(w, s1, '/factory add login');
  const id = ok(cli(w, ['start', '--session', s1])).run_id;
  const bound1 = sessionFile(w, s1);
  assert.equal(bound1.claude_pid, process.pid);
  assert.match(bound1.claude_start, /^sock:\d{4}-\d\d-\d\dT/);
  const step = ok(cli(w, ['next', '--session', s1])).steps[0];
  assert.equal(step.kind, 'ask_human');

  // /clear: the old session ends, a new session id starts in the same Claude process.
  silent(hook(w, 'SessionEnd', { ...base(w, s1), hook_event_name: 'SessionEnd', reason: 'clear' }));
  const nudge = ok(sessionStart(w, s2, 'clear'));
  const ctx = nudge.hookSpecificOutput.additionalContext;
  assert.equal(nudge.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(ctx.includes(id) && ctx.includes('INTAKE') && ctx.includes(`factory next --session ${s2}`), ctx);
  assert.equal(sessionFile(w, s1), null, 'the old session file is gone');
  const bound2 = sessionFile(w, s2);
  assert.deepEqual({ run: bound2.run_id, sup: bound2.supersedes, pid: bound2.claude_pid, start: bound2.claude_start }, { run: id, sup: s1, pid: process.pid, start: bound1.claude_start });
  const started2 = factFile(w, id, s2).find((f) => f.kind === 'session_started');
  assert.deepEqual(started2.data.source, 'clear');
  assert.equal(started2.data.supersedes, s1);
  assert.equal(started2.id, bound2.rebind_fact_id);
  assert.equal(commands(w, id).at(-1).kind, 'step_issued', 'the hook never writes commands');

  // The next holder verb adopts the rebind.
  const n = ok(cli(w, ['next', '--session', s2]));
  assert.deepEqual(n.steps.map((x: any) => x.step_id), [step.step_id]);
  const sb = commands(w, id).at(-1);
  assert.equal(sb.kind, 'session_bound');
  assert.deepEqual(sb.data, { session: s2, supersedes: s1, rebind_fact_id: started2.id });
  assert.equal(sb.session, s2);
  assert.equal(sb.corr, started2.id);
  assert.equal(sessionFile(w, s2).supersedes, undefined, 'adopted: the pending fields are dropped');
  assert.equal(commands(w, id).filter((e) => e.kind === 'session_bound').length, 2, 'adopted once');
  ok(cli(w, ['next', '--session', s2]));
  assert.equal(commands(w, id).filter((e) => e.kind === 'session_bound').length, 2);

  // The new holder records the intake (the conversation step it was handed), then approves it.
  const { confirm } = recordIntake((args) => ok(cli(w, args)), s2);
  type(w, s2, '/factory approve intake');
  const d = ok(cli(w, ['decide', '--session', s2]));
  assert.deepEqual({ decision: d.decision, phase: d.phase, verified: d.verified }, { decision: 'intake_confirmed', phase: 'ORIENT', verified: [confirm.step_id, step.step_id] });
  const st = ok(cli(w, ['status', '--session', s2]));
  assert.deepEqual({ phase: st.phase, holder: st.holder, is_holder: st.is_holder }, { phase: 'ORIENT', holder: s2, is_holder: true });

  const inboxLines = [...inbox(w, s1), ...inbox(w, s2)];
  assert.equal(inboxLines.length, 4);
  valid(inboxLines);
  const facts = allFacts(w, id);
  valid(facts);
  // s1's startup came before the run existed, so its only fact is the SessionEnd(clear).
  assert.deepEqual(factFile(w, id, s1).map((f) => f.kind), ['session_ended']);
  assert.deepEqual(factFile(w, id, s2).map((f) => f.kind), ['session_started']);
});

test('rebind refuses on pid reuse, a null key, no match or two matches; the human types /factory resume', () => {
  const w = world();
  const s1 = randomUUID();
  const id = started(w, s1);
  const f1 = join(w.home, 'sessions', `${s1}.json`);
  const original = readFileSync(f1, 'utf8');

  // Same pid, another process start (pid reuse).
  writeFileSync(f1, JSON.stringify({ ...JSON.parse(original), claude_start: 'sock:1999-01-01T00:00:00.000Z' }));
  silent(sessionStart(w, 'n1', 'clear'));
  assert.equal(sessionFile(w, 'n1'), null);
  assert.ok(existsSync(f1));
  fails(cli(w, ['next', '--session', 'n1']), 'NOT_HOLDER');
  writeFileSync(f1, original);

  // No CLAUDE_PID: no key at all.
  silent(sessionStart(w, 'n2', 'clear', { CLAUDE_PID: undefined }));
  assert.equal(sessionFile(w, 'n2'), null);
  // A null start key in the file never matches either.
  writeFileSync(f1, JSON.stringify({ ...JSON.parse(original), claude_start: null }));
  silent(sessionStart(w, 'n3', 'clear'));
  assert.equal(sessionFile(w, 'n3'), null);
  writeFileSync(f1, original);
  // Another socket: another process.
  const other = join(w.base, 'socks', '999999.sock');
  writeFileSync(other, '');
  silent(sessionStart(w, 'n4', 'clear', { CLAUDE_PID: '999999', CLAUDE_CODE_MESSAGING_SOCKET: other }));
  assert.equal(sessionFile(w, 'n4'), null);
  // Only source clear rebinds.
  silent(sessionStart(w, 'n5', 'startup'));
  assert.equal(sessionFile(w, 'n5'), null);

  // Two live runs held under the same process identity: ambiguous.
  const s2 = randomUUID();
  started(w, s2, 'second task');
  silent(sessionStart(w, 'n6', 'clear'));
  assert.equal(sessionFile(w, 'n6'), null);
  assert.ok(sessionFile(w, s1) && sessionFile(w, s2));

  // The fallback still works: a typed /factory resume takes the run over.
  type(w, 'n6', `/factory resume ${id}`);
  assert.equal(ok(cli(w, ['resume', id, '--session', 'n6'])).supersedes, s1);
});

test('a terminal run is not rebound, and a session file left on it is ignored', () => {
  const w = world();
  const s1 = randomUUID();
  started(w, s1);
  type(w, s1, '/factory abandon');
  assert.equal(ok(cli(w, ['decide', '--session', s1])).phase, 'ABANDONED');
  silent(sessionStart(w, 'n1', 'clear'));
  assert.equal(sessionFile(w, 'n1'), null);
});

test('two /clears before any factory call chain to the run\'s holder; status adopts too', () => {
  const w = world();
  const s1 = randomUUID();
  const id = started(w, s1);
  ok(sessionStart(w, 's2', 'clear'));
  ok(sessionStart(w, 's3', 'clear'));
  assert.equal(sessionFile(w, 's2'), null);
  assert.equal(sessionFile(w, 's3').supersedes, s1);
  const st = ok(cli(w, ['status', '--session', 's3']));
  assert.deepEqual({ holder: st.holder, is_holder: st.is_holder }, { holder: 's3', is_holder: true });
  assert.deepEqual(commands(w, id).at(-1).data.supersedes, s1);
});

test('adoption needs the hook\'s fact: a hand-edited session file is NOT_HOLDER', () => {
  const w = world();
  const s1 = randomUUID();
  const id = started(w, s1);
  const b = sessionFile(w, s1);
  mkdirSync(join(w.home, 'sessions'), { recursive: true });
  writeFileSync(join(w.home, 'sessions', 'forger.json'), JSON.stringify({ ...b, session: 'forger', supersedes: s1, rebind_fact_id: ulid() }));
  fails(cli(w, ['next', '--session', 'forger']), 'NOT_HOLDER');
  assert.equal(commands(w, id).filter((e) => e.kind === 'session_bound').length, 1);
});

test('nudge: a bound holder gets it on startup, clear, resume and compact, with a session_started fact', () => {
  const w = world();
  const s1 = randomUUID();
  const id = started(w, s1);
  for (const source of ['startup', 'resume', 'compact', 'clear']) {
    const ctx = ok(sessionStart(w, s1, source)).hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes(id) && ctx.includes('stage INTAKE') && ctx.includes(`run \`factory next --session ${s1}\``), ctx);
  }
  const started1 = factFile(w, id, s1).filter((f) => f.kind === 'session_started');
  assert.deepEqual(started1.map((f) => f.data.source), ['startup', 'resume', 'compact', 'clear']);
  valid(started1);
  // A bound non-holder gets the fact but no nudge (the holder was taken over).
  type(w, 's2', `/factory resume ${id}`);
  ok(cli(w, ['resume', id, '--session', 's2']));
  writeFileSync(join(w.home, 'sessions', `${s1}.json`), JSON.stringify({ session: s1, repo_hash: commands(w, id)[0].data.repo_hash, run_id: id, claude_pid: null, claude_start: null, bound_at: 'x' }));
  silent(sessionStart(w, s1, 'resume'));
  // Terminal: no nudge.
  type(w, 's2', '/factory abandon');
  ok(cli(w, ['decide', '--session', 's2']));
  silent(sessionStart(w, 's2', 'startup'));
});

// Appends a command as the CLI would, for step kinds 1-3's scheduler doesn't issue yet.
function appendCommand(w: World, runId: string, kind: string, data: object): string {
  const id = ulid();
  const e = { v: 1, id, ts: new Date().toISOString(), run: runId, kind, actor: 'cli', corr: id, data };
  assert.ok(validateEvent(e).ok);
  appendLine(join(runDir(w, runId), 'commands.jsonl'), e);
  return id;
}

test('Stop: allowed at ask_human or with the step running in the background; otherwise blocked whatever stop_hook_active says', () => {
  const w = world();
  const s1 = randomUUID();
  const id = started(w, s1);
  const stop = (session: string, background_tasks: object[] = [], stop_hook_active = false): Out =>
    hook(w, 'Stop', { ...base(w, session), hook_event_name: 'Stop', stop_hook_active, last_assistant_message: 'x', background_tasks });
  silent(stop(s1)); // no open steps
  ok(cli(w, ['next', '--session', s1]));
  silent(stop(s1)); // the intake ask_human
  const spawn = appendCommand(w, id, 'step_issued', { kind: 'spawn', stage: 'INTAKE', attempt: 1, role: 'builder', agent: 'd2t-factory:builder' });
  for (const active of [false, true]) {
    const b = ok(stop(s1, [], active));
    assert.equal(b.decision, 'block');
    assert.ok(b.reason.includes(spawn) && b.reason.includes(`factory next --session ${s1}`), b.reason);
  }
  ok(cli(w, ['claim', spawn, '--session', s1]));
  const builder = { id: 'a1', type: 'subagent', status: 'running', description: 'b', agent_type: 'd2t-factory:builder' };
  silent(stop(s1, [builder]));
  assert.equal(ok(stop(s1, [{ ...builder, status: 'completed' }])).decision, 'block');
  assert.equal(ok(stop(s1, [{ ...builder, agent_type: 'd2t-factory:reviewer-code' }])).decision, 'block');
  // Unbound and non-holder sessions always pass.
  silent(stop('unbound'));
  mkdirSync(join(w.home, 'sessions'), { recursive: true });
  writeFileSync(join(w.home, 'sessions', 'stale.json'), JSON.stringify({ ...sessionFile(w, s1), session: 'stale' }));
  silent(stop('stale'));
  // Terminal runs pass.
  type(w, s1, '/factory abandon');
  ok(cli(w, ['decide', '--session', s1]));
  silent(stop(s1));
});

test('guard: in a bound session, factory-owned writes are denied except the claimed step dir and the conductor\'s plain factory call', () => {
  const w = world();
  const s1 = randomUUID();
  const id = started(w, s1);
  const step = ok(cli(w, ['next', '--session', s1])).steps[0].step_id;
  const pre = (session: string, tool_name: string, tool_input: object, agent?: string): Out =>
    hook(w, 'PreToolUse', { ...base(w, session), hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 't1', ...(agent ? { agent_id: agent, agent_type: 'd2t-factory:builder' } : {}) });
  const denied = (r: Out): string => {
    const o = ok(r).hookSpecificOutput;
    assert.deepEqual([o.hookEventName, o.permissionDecision], ['PreToolUse', 'deny']);
    return o.permissionDecisionReason;
  };
  const stepOut = join(runDir(w, id), 'artifacts', 'steps', step, 'out.md');
  const inboxFile = join(w.home, 'inbox', `${s1}.jsonl`);
  assert.match(denied(pre(s1, 'Write', { file_path: stepOut, content: 'x' })), /factory-owned/, 'issued, not claimed');
  ok(cli(w, ['claim', step, '--session', s1]));
  silent(pre(s1, 'Write', { file_path: stepOut, content: 'x' }, 'agent1'));
  denied(pre(s1, 'Write', { file_path: inboxFile, content: 'x' }, 'agent1'));
  denied(pre(s1, 'Edit', { file_path: join(runDir(w, id), 'commands.jsonl'), old_string: 'a', new_string: 'b' }));
  denied(pre(s1, 'Write', { file_path: transcript(w, s1), content: 'x' }));
  if (process.platform === 'darwin') denied(pre(s1, 'Write', { file_path: inboxFile.replace('.factory', '.FACTORY') }));
  silent(pre(s1, 'Write', { file_path: join(w.repo, 'src', 'a.ts'), content: 'x' }));
  silent(pre(s1, 'Bash', { command: `factory done ${step} --note "see ${stepOut}" --session ${s1}` }));
  assert.match(denied(pre(s1, 'Bash', { command: `factory next --session ${s1}` }, 'agent1')), /agents never call factory/);
  denied(pre(s1, 'Bash', { command: `echo '{}' >> ${inboxFile}` }));
  denied(pre(s1, 'Bash', { command: `factory next --session ${s1} > ${inboxFile}` }));
  silent(pre(s1, 'Bash', { command: `printf ok > ${stepOut}` }, 'agent1'));
  // The INTAKE conversation's out.md stays writable for the conductor once reported (to re-report).
  writeFileSync(stepOut, intakeOut());
  assert.equal(ok(cli(w, ['done', step, '--session', s1])).state, 'reported');
  silent(pre(s1, 'Write', { file_path: stepOut, content: 'x' }));
  denied(pre(s1, 'Write', { file_path: join(runDir(w, id), 'artifacts', 'steps', 'other', 'out.md'), content: 'x' }));
  // Unbound sessions are never touched.
  silent(pre('unbound', 'Write', { file_path: inboxFile }));
});

test('facts: whitelisted, redacted, one per event, in facts/<session>-<agent|main>.jsonl; unbound sessions write none', () => {
  const w = world();
  const s1 = randomUUID();
  const id = started(w, s1);
  const step = ok(cli(w, ['next', '--session', s1])).steps[0].step_id;
  ok(cli(w, ['claim', step, '--session', s1]));
  writeFileSync(join(runDir(w, id), 'redact.json'), JSON.stringify(['hunter2-pass']));
  const stepOut = join(runDir(w, id), 'artifacts', 'steps', step, 'out.md');
  mkdirSync(join(stepOut, '..'), { recursive: true });
  writeFileSync(stepOut, `STATUS: DONE ${'x'.repeat(300)}\nsecond line\n`);
  const ev = (event: string, extra: object, session: string = s1): void => silent(hook(w, event, { ...base(w, session), hook_event_name: event, ...extra }));
  const agent = { agent_id: 'a59c45af6865e54cc', agent_type: 'd2t-factory:builder' };

  ev('SubagentStart', agent);
  ev('PostToolUse', { ...agent, tool_name: 'Write', tool_input: { file_path: stepOut, content: 'secret body' }, tool_response: { filePath: stepOut }, tool_use_id: 'tu1', duration_ms: 3 });
  ev('PostToolUse', { tool_name: 'Write', tool_input: { file_path: join(w.repo, 'a.ts'), content: 'x' }, tool_use_id: 'tu2', duration_ms: 1 });
  ev('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz" -u hunter2-pass x' }, tool_response: { stdout: 'big output' }, tool_use_id: 'tu3', duration_ms: 40 });
  ev('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 'tu4', error: 'Exit code 2\nboom', is_interrupt: false });
  ev('PostToolUseFailure', { tool_name: 'Read', tool_input: { file_path: '/nope' }, tool_use_id: 'tu5', error: 'File does not exist.' });
  ev('SubagentStop', { ...agent, agent_transcript_path: '/t/agent.jsonl', last_assistant_message: 'done', stop_hook_active: false });
  ev('SessionEnd', { reason: 'other' });
  for (const e of ['PostToolUse', 'SubagentStart', 'SessionEnd']) ev(e, { tool_name: 'Bash', tool_input: { command: 'ls' }, ...agent }, 'unbound');

  const main = factFile(w, id, s1);
  const sub = factFile(w, id, s1, agent.agent_id);
  valid([...main, ...sub]);
  assert.deepEqual(sub.map((f) => f.kind), ['subagent_started', 'output_written', 'subagent_stopped']);
  assert.deepEqual(sub[0].data, agent);
  assert.deepEqual(sub[1].data, { path: stepOut, tool_use_id: 'tu1', agent_id: agent.agent_id, first_line: `STATUS: DONE ${'x'.repeat(187)}` });
  assert.deepEqual(sub[2].data, { ...agent, agent_transcript_path: '/t/agent.jsonl' });
  const byTool = main.filter((f) => f.kind !== 'session_started');
  assert.deepEqual(byTool.map((f) => f.kind), ['tool_succeeded', 'tool_succeeded', 'tool_failed', 'tool_failed', 'session_ended']);
  assert.deepEqual(byTool[0].data, { tool_name: 'Write', tool_use_id: 'tu2', duration_ms: 1 });
  assert.deepEqual(byTool[1].data, { tool_name: 'Bash', tool_use_id: 'tu3', command: `curl -H "Authorization: Bearer ${REDACTED}" -u ${REDACTED} x`, duration_ms: 40 });
  assert.deepEqual(byTool[2].data, { tool_name: 'Bash', tool_use_id: 'tu4', command: 'npm test', exit_code: 2 });
  assert.deepEqual(byTool[3].data, { tool_name: 'Read', tool_use_id: 'tu5', exit_code: null });
  assert.deepEqual(byTool[4].data, { reason: 'other' });
  const raw = readdirSync(join(runDir(w, id), 'facts')).map((n) => readFileSync(join(runDir(w, id), 'facts', n), 'utf8')).join('');
  for (const leak of ['secret body', 'big output', 'hunter2-pass', 'abcdefghijklmnopqrstuvwxyz']) assert.ok(!raw.includes(leak), leak);
  assert.deepEqual(readdirSync(join(runDir(w, id), 'facts')).sort(), [`${s1}-${agent.agent_id}.jsonl`, `${s1}-main.jsonl`].sort());
});

test('decide verifies a prompt holding a value from the bound run\'s redact.json', () => {
  const w = world();
  const s1 = randomUUID();
  const id = started(w, s1);
  writeFileSync(join(runDir(w, id), 'redact.json'), JSON.stringify(['hunter2-pass']));
  const pid = type(w, s1, '/factory add login with hunter2-pass');
  assert.ok(inbox(w, s1).every((l) => !JSON.stringify(l).includes('hunter2-pass')));
  const d = ok(cli(w, ['decide', '--session', s1]));
  assert.deepEqual({ intent: d.intent, task: d.task, prompt_id: d.prompt_id }, { intent: 'start', task: `add login with ${REDACTED}`, prompt_id: pid });
  assert.equal(existsSync(join(w.home, 'inbox', 'consumed', pid)), false, 'not consumed as forged');
});

test('a pending /clear rebind (not yet adopted) is the holder for Stop and the nudge', () => {
  const w = world();
  const s1 = randomUUID();
  const s2 = randomUUID();
  const id = started(w, s1);
  ok(cli(w, ['next', '--session', s1]));
  const spawn = appendCommand(w, id, 'step_issued', { kind: 'spawn', stage: 'INTAKE', attempt: 1, role: 'builder', agent: 'd2t-factory:builder' });
  ok(sessionStart(w, s2, 'clear'));
  assert.equal(sessionFile(w, s2).supersedes, s1);
  const b = ok(hook(w, 'Stop', { ...base(w, s2), hook_event_name: 'Stop', stop_hook_active: false, background_tasks: [] }));
  assert.equal(b.decision, 'block');
  assert.ok(b.reason.includes(spawn) && b.reason.includes(`factory next --session ${s2}`), b.reason);
  const ctx = ok(sessionStart(w, s2, 'compact')).hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes(id) && ctx.includes(`factory next --session ${s2}`), ctx);
  assert.equal(commands(w, id).at(-1).id, spawn, 'nothing adopted yet: the hooks never write commands');
});

const psWorks = spawnSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8' }).status === 0;

test('without the messaging socket the start key falls back to ps, and a /clear rebind still works', { skip: !psWorks && 'ps exits non-zero here (sandbox)' }, () => {
  const w = world();
  const NOSOCK = { CLAUDE_CODE_MESSAGING_SOCKET: undefined };
  const s1 = randomUUID();
  const s2 = randomUUID();
  silent(sessionStart(w, s1, 'startup', NOSOCK));
  type(w, s1, '/factory add login');
  const id = ok(cli(w, ['start', '--session', s1], NOSOCK)).run_id;
  assert.match(sessionFile(w, s1).claude_start, /^ps:\S/);
  const ctx = ok(sessionStart(w, s2, 'clear', NOSOCK)).hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes(id), ctx);
  assert.equal(sessionFile(w, s1), null);
  assert.equal(sessionFile(w, s2).supersedes, s1);
  ok(cli(w, ['next', '--session', s2], NOSOCK));
  const sb = commands(w, id).filter((e) => e.kind === 'session_bound').at(-1);
  assert.deepEqual([sb.data.session, sb.data.supersedes], [s2, s1]);
});
