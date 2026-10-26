// End-to-end tests of the 1-2 driver through bin/factory. Hooks arrive in 1-3, so the tests write
// inbox facts and transcript turns directly.
import { strict as assert } from 'node:assert';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { CLAIM_OVERDUE_MS, WAIT_MAX_MS } from '../src/core/config.ts';
import { validateEvent } from '../src/core/events.ts';
import { ulid } from '../src/store/ids.ts';
import { appendLine, readLines } from '../src/store/jsonl.ts';
import { exclusiveDir, exclusiveOwnerFile } from '../src/store/paths.ts';
import { intakeOut, reconOut, recordIntake } from './harness.ts';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

const BIN = join(import.meta.dirname, '..', 'bin', 'factory');

interface World { base: string; home: string; projects: string; agents: string; repo: string; env: Record<string, string> }

function world(): World {
  const base = mkdtempSync(join(tmpdir(), 'factory-driver-'));
  const home = join(base, '.factory');
  mkdirSync(home);
  symlinkSync(process.execPath, join(home, 'node'));
  writeFileSync(join(home, 'plugin-env.json'), '{}\n');
  const projects = join(base, 'projects');
  mkdirSync(join(projects, '-repo'), { recursive: true });
  const agents = join(base, 'agents.json');
  writeFileSync(agents, '[]');
  const repo = join(base, 'repo');
  mkdirSync(repo);
  const g = (...a: string[]): void => { execFileSync('git', a, { cwd: repo, stdio: 'ignore' }); };
  g('init', '-q');
  // One tracked file: a repo whose HEAD tree is empty would be a greenfield run (5-2).
  writeFileSync(join(repo, 'README.md'), '# demo\n');
  g('add', 'README.md');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
  // FACTORY_DASHBOARD_OFF: start and resume answer dashboard_url null and never spawn a server.
  return { base, home, projects, agents, repo, env: { FACTORY_HOME: home, FACTORY_CLAUDE_PROJECTS: projects, FACTORY_CLAUDE_AGENTS_JSON: agents, FACTORY_DASHBOARD_OFF: '1' } };
}

function childEnv(w: World, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...w.env, ...extra };
  if (!('CLAUDE_CODE_SESSION_ID' in extra)) delete env.CLAUDE_CODE_SESSION_ID;
  return env;
}

function run(w: World, args: string[], o: { cwd?: string; env?: Record<string, string>; input?: string } = {}): { code: number | null; out: any } {
  const r = spawnSync(BIN, args, { cwd: o.cwd ?? w.repo, env: childEnv(w, o.env), encoding: 'utf8', input: o.input });
  let out: any = r.stderr;
  try { out = JSON.parse(r.stdout); } catch { /* keep stderr */ }
  return { code: r.status, out };
}

const ok = (r: { code: number | null; out: any }): any => { assert.equal(r.code, 0, JSON.stringify(r.out)); return r.out; };
const fails = (r: { code: number | null; out: any }, code: string, msg?: RegExp): void => {
  assert.equal(r.code, 1, JSON.stringify(r.out));
  assert.equal(r.out.error?.code, code, JSON.stringify(r.out));
  if (msg) assert.match(r.out.error.message, msg);
};

// Transcript lines are Claude Code's own format, not factory events.
const turnLine = (file: string, line: object): void => { mkdirSync(join(file, '..'), { recursive: true }); appendFileSync(file, JSON.stringify(line) + '\n'); };

let seq = 0;
interface SayOpts { turn?: Record<string, unknown> | null; transcriptPath?: string; text?: string; project?: string }

// The two prompt facts the 1-3 hooks will write, plus the matching transcript turn.
function say(w: World, session: string, args: string, o: SayOpts = {}): string {
  const prompt_id = `prompt-${++seq}`;
  const inbox = join(w.home, 'inbox', `${session}.jsonl`);
  const fact = (kind: string, data: object): object => ({ v: 1, id: ulid(), ts: new Date().toISOString(), session, kind, actor: 'hook', corr: null, data });
  const typed = o.text ?? `/factory ${args}`.trim();
  const tp = o.transcriptPath ? { transcript_path: o.transcriptPath } : {};
  appendLine(inbox, fact('human_prompt', { prompt_id, command_name: 'd2t-factory:factory', command_args: args, ...tp }));
  appendLine(inbox, fact('prompt_text', { prompt_id, prompt: typed, ...tp }));
  if (o.turn !== null) {
    const content = `<command-message>factory is running…</command-message>\n<command-name>/factory</command-name>\n<command-args>${args}</command-args>`;
    turnLine(join(w.projects, o.project ?? '-repo', `${session}.jsonl`), { type: 'user', promptId: prompt_id, sessionId: session, turnOrigin: 'human', message: { role: 'user', content }, ...o.turn });
  }
  return prompt_id;
}

const consumed = (w: World, pid: string): string | null => {
  const dir = join(w.home, 'inbox', 'consumed', pid);
  if (!existsSync(dir)) return null;
  try { return readFileSync(join(dir, 'reason'), 'utf8').trim(); } catch { return ''; }
};

function runFile(w: World, runId: string, name = 'commands.jsonl'): string {
  const hash = readdirSync(w.home).find((h) => existsSync(join(w.home, h, 'runs', runId)));
  assert.ok(hash, `run ${runId} not found`);
  return join(w.home, hash, 'runs', runId, name);
}
const commands = (w: World, runId: string): any[] => readLines<any>(runFile(w, runId)).items;
const sessionFile = (w: World, s: string): any => { try { return JSON.parse(readFileSync(join(w.home, 'sessions', `${s}.json`), 'utf8')); } catch { return null; } };

// start a run on a typed task; returns the run id.
function started(w: World, session: string, task = 'add login'): string {
  say(w, session, task);
  return ok(run(w, ['start', '--session', session])).run_id;
}

test('start consumes the task prompt, embeds it in run_started, then binds the session', () => {
  const w = world();
  const pid = say(w, 'sa', 'add login');
  const out = ok(run(w, ['start', '--session', 'sa']));
  assert.match(out.run_id, /^add-login-[0-9a-z]{4}$/);
  assert.equal(out.dashboard_url, null);
  assert.equal(consumed(w, pid), 'started');
  const cmds = commands(w, out.run_id);
  assert.deepEqual(cmds.map((e) => e.kind), ['run_started', 'session_bound', 'check_ran']);
  const [rs, sb, bl] = cmds;
  // 1-4: the main checkout's status digest is the brownfield baseline (AD-8).
  assert.deepEqual({ check: bl.data.check, exit: bl.data.exit_code, basis: bl.data.basis_seq, sha: bl.data.sha }, { check: 'git.baseline', exit: 0, basis: 2, sha: rs.data.base_sha });
  assert.match(bl.data.digest, /^[0-9a-f]{64}$/);
  assert.equal(rs.data.task, 'add login');
  assert.equal(rs.data.branch, `factory/${out.run_id}`);
  assert.match(rs.data.base_sha, /^[0-9a-f]{40}$/);
  assert.match(rs.data.repo_hash, /^[0-9a-f]{12}$/);
  assert.equal(rs.data.human_prompt.data.prompt_id, pid);
  assert.equal(rs.data.prompt_text.data.prompt, '/factory add login');
  assert.equal(rs.data.prompt_fact_id, rs.data.human_prompt.id);
  assert.equal(sb.data.session, 'sa');
  const sf = sessionFile(w, 'sa');
  assert.equal(sf.run_id, out.run_id);
  assert.equal(sf.repo_hash, rs.data.repo_hash);
  assert.ok('claude_pid' in sf && 'claude_start' in sf);
  fails(run(w, ['start', '--session', 'sa']), 'NO_HUMAN_PROMPT');
});

test('start refuses before setup and without plugin-env.json; outside a git repo it initialises a greenfield run (5-2), and a repo with tracked files stays brownfield', () => {
  const w = world();
  say(w, 'sa', 'add login');
  const brown = ok(run(w, ['start', '--session', 'sa'])).run_id;
  assert.equal(commands(w, brown)[0].data.greenfield, undefined, 'brownfield: run_started is unchanged');
  const outside = mkdtempSync(join(tmpdir(), 'factory-nogit-'));
  say(w, 'sb', 'add login');
  const green = ok(run(w, ['start', '--session', 'sb'], { cwd: outside })).run_id;
  const rs = commands(w, green)[0];
  assert.equal(rs.data.greenfield, true);
  assert.equal(rs.data.base_sha, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: outside, encoding: 'utf8' }).trim());
  assert.equal(execFileSync('git', ['log', '--format=%s'], { cwd: outside, encoding: 'utf8' }), 'factory: init\n');
  rmSync(join(w.home, 'plugin-env.json'));
  fails(run(w, ['start', '--session', 'sa']), 'SETUP_REQUIRED', /restart the session/);
  rmSync(join(w.home, 'node'));
  fails(run(w, ['start', '--session', 'sa']), 'SETUP_REQUIRED', /factory setup/);
  fails(run(w, ['start', '--session', 'sa'], { env: { FACTORY_HOME: join(w.base, 'missing') } }), 'SETUP_REQUIRED');
});

test('bare /factory: start takes the positional task; a positional that differs from a typed task is BAD_ARGS', () => {
  const w = world();
  const pid = say(w, 'sa', '');
  fails(run(w, ['start', '--session', 'sa']), 'BAD_ARGS', /bare/);
  assert.equal(consumed(w, pid), null);
  const out = ok(run(w, ['start', 'fix', 'the', 'footer', '--session', 'sa']));
  assert.equal(commands(w, out.run_id)[0].data.task, 'fix the footer');
  assert.equal(consumed(w, pid), 'started');

  const w2 = world();
  const p2 = say(w2, 'sa', 'add login');
  fails(run(w2, ['start', 'something else', '--session', 'sa']), 'BAD_ARGS', /differs/);
  assert.equal(consumed(w2, p2), null);
  ok(run(w2, ['start', 'add login', '--session', 'sa']));
});

test('next issues one intake conversation step with a brief and an output path; a second next reissues nothing; claim on a non-issued step is CLAIM_TAKEN', () => {
  const w = world();
  const id = started(w, 'sa');
  const a = ok(run(w, ['next', '--session', 'sa']));
  assert.equal(a.steps.length, 1);
  const st = a.steps[0];
  assert.deepEqual([st.kind, st.stage, st.card.type, st.card.commands], ['ask_human', 'INTAKE', 'intake', []], 'a conversation: no decision answers it');
  assert.equal(st.output_path, join(runFile(w, id, ''), 'artifacts', 'steps', st.step_id, 'out.md'));
  const brief = readFileSync(st.brief_path, 'utf8');
  for (const want of ['task: add login', st.output_path, 'limit_min', 'slice_timebox_min', 'ui_free', 'reviewer_overrides', '`started`', 'the step_id the last done returned']) assert.ok(brief.includes(want), `${want} in\n${brief}`);
  assert.ok(!brief.includes('started:'), 'no concrete started to copy');
  assert.deepEqual(a.in_flight, []);
  const b = ok(run(w, ['next', '--session', 'sa']));
  assert.deepEqual(b.steps, a.steps);
  assert.equal(commands(w, id).filter((e) => e.kind === 'step_issued').length, 1);
  assert.equal(commands(w, id).find((e) => e.kind === 'step_issued').id, st.step_id);

  ok(run(w, ['claim', st.step_id, '--agent-id', 'agent-7', '--session', 'sa']));
  assert.equal(commands(w, id).at(-1).data.agent_id, 'agent-7');
  assert.equal(ok(run(w, ['status', '--session', 'sa'])).open_steps[0].agent_id, 'agent-7');
  fails(run(w, ['claim', st.step_id, '--session', 'sa']), 'CLAIM_TAKEN');
  fails(run(w, ['claim', 'NOPE', '--session', 'sa']), 'NOT_FOUND');
  for (const bad of ['constructor', '__proto__']) {
    fails(run(w, ['claim', bad, '--session', 'sa']), 'NOT_FOUND');
    fails(run(w, ['done', bad, '--note', 'x', '--session', 'sa']), 'NOT_FOUND');
  }
  const c = ok(run(w, ['next', '--session', 'sa']));
  assert.deepEqual(c.steps, []);
  assert.deepEqual(c.in_flight, [st.step_id]);
  assert.equal(c.wait, undefined, 'only a card in flight and no deadline: the conductor ends its turn');
  fails(run(w, ['done', st.step_id, '--note', 'x', '--stdin', '--session', 'sa']), 'BAD_ARGS');
});

test('intake done: bad front matter is MISSING_EVIDENCE with nothing appended and the step still claimed; a valid intake is reported and the confirm card shows its task, scope and settings', () => {
  const w = world();
  const id = started(w, 'sa');
  const st = ok(run(w, ['next', '--session', 'sa'])).steps[0];
  ok(run(w, ['claim', st.step_id, '--session', 'sa']));
  const before = commands(w, id).length;
  fails(run(w, ['done', st.step_id, '--session', 'sa']), 'MISSING_EVIDENCE', /no output file/);
  for (const [text, why] of [
    [intakeOut({ limit_min: 'two hours' }), /limit_min must be a whole number/],
    [intakeOut({ reviewer_overrides: { add: [], remove: ['reviewer-code'] } }), /reviewer-code always runs/],
    [intakeOut({ started: 'yesterday-ish' }), /started must be an ISO-8601 time/],
    [intakeOut({ ui_free: undefined }), /ui_free must be true or false/],
    [intakeOut({ task: undefined }), /task must be a non-empty one-line string/],
    [intakeOut({ scope: ['the footer'] }), /scope must be a JSON object \{"in": \[\.\.\.\], "out": \[\.\.\.\]\}/],
    [intakeOut({ limit_min: undefined, started: '2026-10-24T14:05:00.000Z' }), /started needs limit_min/],
    [intakeOut().replace('STATUS: DONE', 'STATUS: ESCALATE\nScope change: unclear'), /line 1 must be `STATUS: DONE`/],
  ] as const) {
    writeFileSync(st.output_path, text);
    fails(run(w, ['done', st.step_id, '--session', 'sa']), 'MISSING_EVIDENCE', why);
  }
  assert.equal(commands(w, id).length, before, 'nothing appended');
  assert.equal(ok(run(w, ['status', '--session', 'sa'])).open_steps[0].state, 'claimed');

  writeFileSync(st.output_path, intakeOut({ slice_timebox_min: undefined }));
  const d = ok(run(w, ['done', st.step_id, '--note', 'agreed', '--session', 'sa']));
  assert.deepEqual(d, { step_id: st.step_id, state: 'reported' });
  const rep = commands(w, id).at(-1);
  assert.deepEqual([rep.kind, rep.actor, rep.data.note, rep.data.output.status, rep.data.output.front.limit_min], ['step_reported', 'conductor', 'agreed', 'DONE', 120]);
  assert.equal(rep.data.output.sha256, sha256(intakeOut({ slice_timebox_min: undefined })));
  const n = ok(run(w, ['next', '--session', 'sa']));
  assert.equal(n.steps.length, 1);
  assert.deepEqual({ type: n.steps[0].card.type, reason: n.steps[0].card.reason, details: n.steps[0].card.details, commands: n.steps[0].card.commands }, {
    type: 'intake', reason: 'time limit 2:00 · slice time box 30 min · UI-free no · reviewers: default', details: ['Task: add a footer', 'In scope: the footer', 'Out of scope: —'], commands: ['/factory approve intake'],
  });
  // 6-2: card_text is the card in the AD-34 order, for the conductor to print verbatim.
  assert.equal(n.steps[0].card_text, [
    'Intake — confirm the task', 'time limit 2:00 · slice time box 30 min · UI-free no · reviewers: default',
    'Task: add a footer', 'In scope: the footer', 'Out of scope: —',
    'To continue, type one of:', '  /factory approve intake — RECON maps the repo, then SCAFFOLD; the next stop is Gate 1',
    "Reply in chat to change any of this; you'll get this card again.",
  ].join('\n'));
  assert.deepEqual(n.in_flight, [st.step_id]);
  assert.deepEqual(ok(run(w, ['next', '--session', 'sa'])).steps.map((x: any) => x.step_id), [n.steps[0].step_id], 'one confirm card');
  say(w, 'sa', 'approve intake');
  ok(run(w, ['decide', '--session', 'sa']));
  assert.equal(commands(w, id).find((e) => e.kind === 'intake_confirmed').data.intake.slice_timebox_min, 30, 'a missing time box becomes 30');
});

test('intake changed: done again on the reported step reissues it with the same out.md, reports the new step, closes the stale confirm card and a fresh one follows', () => {
  const w = world();
  const id = started(w, 'sa');
  const cli = (args: string[]): any => ok(run(w, args));
  const { chat, confirm } = recordIntake(cli, 'sa');
  writeFileSync(chat.output_path, intakeOut({ limit_min: 90, ui_free: true, reviewer_overrides: { add: ['reviewer-security'], remove: ['reviewer-ux'] } }));
  const d = ok(run(w, ['done', chat.step_id, '--session', 'sa']));
  assert.notEqual(d.step_id, chat.step_id);
  assert.deepEqual([d.state, d.reissued_from], ['reported', chat.step_id]);
  const tail = commands(w, id).slice(-5);
  assert.deepEqual(tail.map((e) => e.kind), ['step_claimed', 'step_verified', 'step_reissued', 'step_claimed', 'step_reported']);
  assert.deepEqual(tail[1].data, { step_id: confirm.step_id, evidence: [`superseded:${d.step_id}`] });
  assert.deepEqual([tail[2].data.old, tail[2].data.new, tail[2].data.output_path], [chat.step_id, d.step_id, chat.output_path]);
  const fresh = ok(run(w, ['next', '--session', 'sa'])).steps;
  assert.equal(fresh.length, 1);
  assert.notEqual(fresh[0].step_id, confirm.step_id);
  assert.equal(fresh[0].card.reason, 'time limit 1:30 · slice time box 30 min · UI-free yes · reviewers: +reviewer-security -reviewer-ux');
  // The old step id is gone; the new one is what the next done names.
  fails(run(w, ['done', chat.step_id, '--session', 'sa']), 'ILLEGAL_TRANSITION', /is reissued/);
  say(w, 'sa', 'approve intake');
  const ap = ok(run(w, ['decide', '--session', 'sa']));
  assert.deepEqual(ap.verified, [fresh[0].step_id, d.step_id]);
  assert.deepEqual(commands(w, id).find((e) => e.kind === 'intake_confirmed').data.intake, {
    task: 'add a footer', scope: { in: ['the footer'], out: [] }, limit_min: 90, slice_timebox_min: 30, ui_free: true, reviewer_overrides: { add: ['reviewer-security'], remove: ['reviewer-ux'] },
  });
});

test('intake changed after the confirm card was claimed: the claimed card is closed as superseded, and a fresh card shows the new fields', () => {
  const w = world();
  const id = started(w, 'sa');
  const { chat, confirm } = recordIntake((args) => ok(run(w, args)), 'sa');
  ok(run(w, ['claim', confirm.step_id, '--session', 'sa'])); // the conductor printed it
  writeFileSync(chat.output_path, intakeOut({ limit_min: 150, slice_timebox_min: 45 }));
  const d = ok(run(w, ['done', chat.step_id, '--session', 'sa']));
  const tail = commands(w, id).slice(-4);
  assert.deepEqual(tail.map((e) => e.kind), ['step_verified', 'step_reissued', 'step_claimed', 'step_reported']);
  assert.deepEqual(tail[0].data, { step_id: confirm.step_id, evidence: [`superseded:${d.step_id}`] });
  assert.equal(tail[3].data.step_id, d.step_id);
  const fresh = ok(run(w, ['next', '--session', 'sa'])).steps;
  assert.deepEqual(fresh.map((x: any) => x.card.reason), ['time limit 2:30 · slice time box 45 min · UI-free no · reviewers: default']);
  assert.notEqual(fresh[0].step_id, confirm.step_id);
});

test('wait at a reported agent step whose facts have not landed: retry_after_ms runs to its claim overdue_at', () => {
  const w = world();
  started(w, 'sa');
  recordIntake((args) => ok(run(w, args)), 'sa');
  say(w, 'sa', 'approve intake');
  ok(run(w, ['decide', '--session', 'sa']));
  const recon = ok(run(w, ['next', '--session', 'sa'])).steps[0];
  assert.equal(recon.agent, 'd2t-factory:recon');
  ok(run(w, ['claim', recon.step_id, '--session', 'sa']));
  writeFileSync(recon.output_path, reconOut());
  assert.equal(ok(run(w, ['done', recon.step_id, '--session', 'sa'])).state, 'reported', 'no output_written or subagent_stopped fact yet');
  const n = ok(run(w, ['next', '--session', 'sa']));
  assert.deepEqual([n.steps, n.in_flight], [[], [recon.step_id]]);
  assert.ok(n.wait.retry_after_ms > 0 && n.wait.retry_after_ms <= CLAIM_OVERDUE_MS, `retry_after_ms ${n.wait.retry_after_ms}`);
});

test('acceptance: start → next → intake recorded → decide(approve intake) → next ends in ORIENT with both intake steps verified, the fields recorded and the out.md pinned, and RECON is issued', () => {
  const w = world();
  const id = started(w, 'sa');
  const { chat, confirm } = recordIntake((args) => ok(run(w, args)), 'sa');
  ok(run(w, ['claim', confirm.step_id, '--session', 'sa']));
  const pid = say(w, 'sa', 'approve intake');
  const d = ok(run(w, ['decide', '--session', 'sa']));
  assert.equal(d.decision, 'intake_confirmed');
  assert.equal(d.phase, 'ORIENT');
  assert.deepEqual(d.verified, [confirm.step_id, chat.step_id]);
  assert.equal(consumed(w, pid), 'decided');
  const tail = commands(w, id).slice(-3);
  assert.deepEqual(tail.map((e) => e.kind), ['intake_confirmed', 'step_verified', 'step_verified']);
  const [ic] = tail;
  assert.equal(ic.actor, 'human');
  assert.equal(ic.session, 'sa');
  assert.equal(ic.data.human_prompt.data.prompt_id, pid);
  assert.equal(ic.data.prompt_text.data.prompt, '/factory approve intake');
  assert.deepEqual(ic.data.intake, { task: 'add a footer', scope: { in: ['the footer'], out: [] }, limit_min: 120, slice_timebox_min: 30, ui_free: false, reviewer_overrides: { add: [], remove: [] } });
  assert.equal(ic.data.clock_start, commands(w, id)[0].ts, 'no started: the clock starts with the run');
  assert.deepEqual(ic.data.pins, [{ path: chat.output_path, sha256: sha256(intakeOut()) }]);
  assert.deepEqual(ic.data.evidence, [chat.step_id]);
  assert.deepEqual([tail[1].data.step_id, tail[2].data.step_id, tail[2].data.evidence], [confirm.step_id, chat.step_id, [ic.id]]);
  const st = ok(run(w, ['status', '--session', 'sa']));
  assert.equal(st.phase, 'ORIENT');
  assert.deepEqual(st.open_steps, []);
  const n = ok(run(w, ['next', '--session', 'sa']));
  assert.deepEqual(n.in_flight, []);
  assert.deepEqual(n.steps.map((x: any) => [x.kind, x.stage, x.agent]), [['spawn', 'RECON', 'd2t-factory:recon']]);
});

test('approve intake: refused with no recorded intake (ILLEGAL_TRANSITION) and when the out.md changed since done (MISSING_EVIDENCE); the unclaimed confirm card is claimed for the decider', () => {
  const w = world();
  const id = started(w, 'sa');
  const p0 = say(w, 'sa', 'approve intake');
  fails(run(w, ['decide', '--session', 'sa']), 'ILLEGAL_TRANSITION', /no recorded intake/);
  assert.equal(consumed(w, p0), 'illegal');
  const chat = ok(run(w, ['next', '--session', 'sa'])).steps[0];
  ok(run(w, ['claim', chat.step_id, '--session', 'sa']));
  writeFileSync(chat.output_path, intakeOut());
  say(w, 'sa', 'approve intake');
  fails(run(w, ['decide', '--session', 'sa']), 'ILLEGAL_TRANSITION', /no recorded intake/); // written but not reported
  ok(run(w, ['done', chat.step_id, '--session', 'sa']));
  const confirm = ok(run(w, ['next', '--session', 'sa'])).steps[0];
  writeFileSync(chat.output_path, intakeOut({ limit_min: 60 }));
  const p1 = say(w, 'sa', 'approve intake');
  fails(run(w, ['decide', '--session', 'sa']), 'MISSING_EVIDENCE', /changed since/);
  assert.equal(consumed(w, p1), 'missing_evidence');
  writeFileSync(chat.output_path, intakeOut());
  say(w, 'sa', 'approve intake');
  assert.deepEqual(ok(run(w, ['decide', '--session', 'sa'])).verified, [confirm.step_id, chat.step_id]);
  assert.deepEqual(commands(w, id).slice(-4).map((e) => [e.kind, e.session ?? null]), [['intake_confirmed', 'sa'], ['step_claimed', 'sa'], ['step_verified', null], ['step_verified', null]]);
  assert.deepEqual(ok(run(w, ['next', '--session', 'sa'])).steps.map((x: any) => x.agent), ['d2t-factory:recon']);
});

test('intake (6-2): no time limit is valid; the card says so, the clock starts with the run, and the intake carries no limit', () => {
  const w = world();
  const id = started(w, 'sa');
  const { confirm } = recordIntake((args) => ok(run(w, args)), 'sa', { limit_min: undefined });
  assert.equal(confirm.card.reason, 'no time limit · slice time box 30 min · UI-free no · reviewers: default');
  say(w, 'sa', 'approve intake');
  ok(run(w, ['decide', '--session', 'sa']));
  const ic = commands(w, id).find((e) => e.kind === 'intake_confirmed');
  assert.equal('limit_min' in ic.data.intake, false);
  assert.equal(ic.data.clock_start, commands(w, id)[0].ts);
});

test('intake: an earlier start of the time limit moves the clock start back; a later one leaves it at the run start', () => {
  for (const [offset, earlier] of [[-3600_000, true], [3600_000, false]] as const) {
    const w = world();
    const id = started(w, 'sa');
    const at = new Date(Date.now() + offset).toISOString();
    recordIntake((args) => ok(run(w, args)), 'sa', { started: at });
    say(w, 'sa', 'approve intake');
    ok(run(w, ['decide', '--session', 'sa']));
    const ic = commands(w, id).find((e) => e.kind === 'intake_confirmed');
    assert.equal(ic.data.intake.started, at);
    assert.equal(ic.data.clock_start, earlier ? at : commands(w, id)[0].ts);
  }
});

test('decide rolls back the ledger entry when the append fails', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, () => {
  const w = world();
  const id = started(w, 'sa');
  recordIntake((args) => ok(run(w, args)), 'sa');
  const pid = say(w, 'sa', 'approve intake');
  const file = runFile(w, id);
  chmodSync(file, 0o444);
  try {
    const r = run(w, ['decide', '--session', 'sa']);
    assert.equal(r.code, 1);
    assert.equal(consumed(w, pid), null);
  } finally {
    chmodSync(file, 0o644);
  }
  assert.equal(ok(run(w, ['decide', '--session', 'sa'])).phase, 'ORIENT');
  assert.equal(consumed(w, pid), 'decided');
});

test('an illegal decision is consumed and returns ILLEGAL_TRANSITION', () => {
  const w = world();
  const id = started(w, 'sa');
  const before = commands(w, id).length;
  const p1 = say(w, 'sa', 'approve gate1');
  fails(run(w, ['decide', '--session', 'sa']), 'ILLEGAL_TRANSITION');
  assert.equal(consumed(w, p1), 'illegal');
  const p2 = say(w, 'sa', 'merge');
  fails(run(w, ['decide', '--session', 'sa']), 'ILLEGAL_TRANSITION', /merge_approved in INTAKE/);
  assert.equal(consumed(w, p2), 'illegal');
  const p3 = say(w, 'sa', 'choose a');
  fails(run(w, ['decide', '--session', 'sa']), 'ILLEGAL_TRANSITION', /design_choice_made/);
  assert.equal(consumed(w, p3), 'illegal');
  assert.equal(commands(w, id).length, before);
  fails(run(w, ['decide', '--session', 'sa']), 'NO_HUMAN_PROMPT');
});

test('non-decisions (task text, resume <id>, bare) are returned with a resolution and not consumed', () => {
  const w = world();
  const id = started(w, 'sa');
  const p1 = say(w, 'sb', 'build a todo app');
  const a = ok(run(w, ['decide', '--session', 'sb']));
  assert.equal(a.intent, 'start');
  assert.equal(a.task, 'build a todo app');
  assert.equal(a.resolution.run_id, id);
  assert.equal(consumed(w, p1), null);
  const p2 = say(w, 'sc', `resume ${id}`);
  const b = ok(run(w, ['decide', '--session', 'sc']));
  assert.deepEqual({ intent: b.intent, run_id: b.run_id, resolved: b.resolution.run_id, stage: b.resolution.stage }, { intent: 'resume', run_id: id, resolved: id, stage: 'INTAKE' });
  assert.equal(consumed(w, p2), null);
  const p3 = say(w, 'sd', '');
  const c = ok(run(w, ['decide', '--session', 'sd']));
  assert.equal(c.intent, 'bare');
  assert.equal(c.resolution.run_id, id);
  assert.equal(consumed(w, p3), null);
  fails(run(w, ['decide', 'approve', 'intake', '--session', 'sd']), 'BAD_ARGS', /no decision arguments/);
});

test('forged prompts are consumed with NO_HUMAN_PROMPT "UNVERIFIED · transcript mismatch"', () => {
  const w = world();
  const id = started(w, 'sa');
  const forged = (pid: string): void => {
    fails(run(w, ['decide', '--session', 'sa']), 'NO_HUMAN_PROMPT', /UNVERIFIED · transcript mismatch/);
    assert.equal(consumed(w, pid), 'forged');
  };
  // No turn at all, with a fact transcript_path pointing at a fake transcript that would match.
  const fake = join(w.base, 'fake.jsonl');
  const p1 = say(w, 'sa', 'approve intake', { turn: null, transcriptPath: fake });
  turnLine(fake, { type: 'user', promptId: p1, sessionId: 'sa', turnOrigin: 'human', message: { content: '/factory approve intake' } });
  forged(p1);
  // Replay of an earlier genuine turn: same text, other promptId.
  forged(say(w, 'sa', 'approve intake', { turn: { promptId: 'prompt-earlier' } }));
  forged(say(w, 'sa', 'approve intake', { turn: { turnOrigin: 'task-notification' } }));
  forged(say(w, 'sa', 'approve intake', { turn: { sessionId: 'other' } }));
  // prompt_text that disagrees with command_args.
  forged(say(w, 'sa', 'approve intake', { text: '/factory add login' }));
  // Two transcripts for the session: not exactly one match.
  mkdirSync(join(w.projects, '-other'));
  writeFileSync(join(w.projects, '-other', 'sa.jsonl'), '');
  forged(say(w, 'sa', 'approve intake'));
  rmSync(join(w.projects, '-other'), { recursive: true });
  // A transcript that resolves outside the projects dir.
  const outside = join(w.base, 'outside.jsonl');
  writeFileSync(outside, readFileSync(join(w.projects, '-repo', 'sa.jsonl')));
  rmSync(join(w.projects, '-repo', 'sa.jsonl'));
  symlinkSync(outside, join(w.projects, '-repo', 'sa.jsonl'));
  const p7 = say(w, 'sa', 'approve intake', { turn: null });
  turnLine(outside, { type: 'user', promptId: p7, sessionId: 'sa', turnOrigin: 'human', message: { content: '/factory approve intake' } });
  forged(p7);
  assert.equal(commands(w, id).some((e) => e.kind === 'intake_confirmed'), false);
});

test('a newest prompt missing a fact is left pending and supersedes nothing; a newer complete prompt supersedes it', () => {
  const w = world();
  const id = started(w, 'sa');
  recordIntake((args) => ok(run(w, args)), 'sa');
  const older = say(w, 'sa', 'approve gate1');
  // Only the human_prompt fact of the newest prompt is written so far (no prompt_text, no turn).
  const half = 'prompt-half';
  appendLine(join(w.home, 'inbox', 'sa.jsonl'), { v: 1, id: ulid(), ts: new Date().toISOString(), session: 'sa', kind: 'human_prompt', actor: 'hook', corr: null, data: { prompt_id: half, command_name: 'd2t-factory:factory', command_args: 'approve intake' } });
  fails(run(w, ['decide', '--session', 'sa']), 'NO_HUMAN_PROMPT', /prompt-half is not fully recorded yet/);
  assert.deepEqual([consumed(w, half), consumed(w, older)], [null, null], 'neither forged nor superseded');
  // Its text alone (still no human_prompt) is incomplete the other way round.
  const half2 = 'prompt-half2';
  appendLine(join(w.home, 'inbox', 'sa.jsonl'), { v: 1, id: ulid(), ts: new Date().toISOString(), session: 'sa', kind: 'prompt_text', actor: 'hook', corr: null, data: { prompt_id: half2, prompt: '/factory approve intake' } });
  fails(run(w, ['decide', '--session', 'sa']), 'NO_HUMAN_PROMPT', /prompt-half2 is not fully recorded yet/);
  assert.equal(consumed(w, half2), null);
  // A newer complete prompt is decided and supersedes the incomplete ones too.
  const newer = say(w, 'sa', 'approve intake');
  assert.equal(ok(run(w, ['decide', '--session', 'sa'])).decision, 'intake_confirmed');
  assert.deepEqual([consumed(w, newer), consumed(w, half), consumed(w, half2), consumed(w, older)], ['decided', 'superseded', 'superseded', 'superseded']);
  assert.equal(commands(w, id).filter((e) => e.kind === 'intake_confirmed').length, 1);
});

test('a complete prompt whose turn is not in the transcript yet is re-read once before it is consumed as forged', async () => {
  const w = world();
  started(w, 'sa');
  const prev = { ...process.env };
  Object.assign(process.env, w.env);
  try {
    const { newestPrompt } = await import('../src/cli/prompt.ts');
    // The turn lands while newestPrompt waits: the prompt is verified, nothing is consumed.
    const p1 = say(w, 'sa', 'approve intake', { turn: null });
    const waits: number[] = [];
    const flush = (ms: number): void => {
      waits.push(ms);
      turnLine(join(w.projects, '-repo', 'sa.jsonl'), { type: 'user', promptId: p1, sessionId: 'sa', turnOrigin: 'human', message: { role: 'user', content: '<command-message>factory is running…</command-message>\n<command-name>/factory</command-name>\n<command-args>approve intake</command-args>' } });
    };
    const p = newestPrompt('sa', flush);
    assert.equal(p.prompt_id, p1);
    assert.equal(waits.length, 1);
    assert.ok(waits[0] > 0 && waits[0] <= 500, `waited ${waits[0]} ms`);
    assert.equal(consumed(w, p1), null);
    // A matching turn needs no wait.
    const none: number[] = [];
    assert.equal(newestPrompt('sa', (ms) => none.push(ms)).prompt_id, p1);
    assert.deepEqual(none, []);
    // Still missing after the one re-read: forged, as before.
    const p2 = say(w, 'sa', 'approve intake', { turn: null });
    const twice: number[] = [];
    assert.throws(() => newestPrompt('sa', (ms) => twice.push(ms)), /UNVERIFIED · transcript mismatch/);
    assert.equal(twice.length, 1);
    assert.equal(consumed(w, p2), 'forged');
    assert.equal(consumed(w, p1), 'superseded');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
    Object.assign(process.env, prev);
  }
});

test('the newest prompt wins and older ones are superseded; no prompt is NO_HUMAN_PROMPT', () => {
  const w = world();
  fails(run(w, ['decide', '--session', 'sa']), 'NO_HUMAN_PROMPT');
  const id = started(w, 'sa');
  recordIntake((args) => ok(run(w, args)), 'sa');
  const old = say(w, 'sa', 'approve gate1');
  const newer = say(w, 'sa', 'approve intake');
  assert.equal(ok(run(w, ['decide', '--session', 'sa'])).decision, 'intake_confirmed');
  assert.equal(consumed(w, old), 'superseded');
  assert.equal(consumed(w, newer), 'decided');
  assert.equal(commands(w, id).filter((e) => e.kind === 'intake_confirmed').length, 1);
  // A late duplicate fact of an older prompt doesn't make it the newest.
  const a = say(w, 'sa', 'approve gate1');
  const b = say(w, 'sa', 'merge');
  const lines = readFileSync(join(w.home, 'inbox', 'sa.jsonl'), 'utf8').trim().split('\n');
  appendFileSync(join(w.home, 'inbox', 'sa.jsonl'), lines.at(-4) + '\n'); // a's human_prompt again
  fails(run(w, ['decide', '--session', 'sa']), 'ILLEGAL_TRANSITION', /merge_approved/);
  assert.deepEqual([consumed(w, a), consumed(w, b)], ['superseded', 'illegal']);
});

test('non-holders get NOT_HOLDER on next, claim and done; decide is exempt', () => {
  const w = world();
  started(w, 'sa');
  const step = ok(run(w, ['next', '--session', 'sa'])).steps[0];
  fails(run(w, ['next', '--session', 'sb']), 'NOT_HOLDER');
  fails(run(w, ['claim', step.step_id, '--session', 'sb']), 'NOT_HOLDER');
  ok(run(w, ['claim', step.step_id, '--session', 'sa']));
  writeFileSync(step.output_path, intakeOut());
  fails(run(w, ['done', step.step_id, '--note', 'x', '--session', 'sb']), 'NOT_HOLDER');
  ok(run(w, ['done', step.step_id, '--session', 'sa']));
  ok(run(w, ['next', '--session', 'sa']));
  say(w, 'sb', 'approve intake');
  assert.equal(ok(run(w, ['decide', '--session', 'sb'])).phase, 'ORIENT');
});

test('bare resume defers to a live holder; typed resume <id> always rebinds', () => {
  const w = world();
  const id = started(w, 'sa');
  writeFileSync(w.agents, JSON.stringify([{ sessionId: 'sa', pid: 1 }]));
  const p1 = say(w, 'sb', '');
  const taken = run(w, ['resume', '--session', 'sb']);
  fails(taken, 'CLAIM_TAKEN');
  assert.equal(taken.out.error.message, `Run ${id} is already claimed by another session. Type /factory resume ${id} to take it over.`);
  assert.equal(consumed(w, p1), null);
  // Holder gone from `claude agents --json`: the bare resume rebinds.
  writeFileSync(w.agents, JSON.stringify([{ session_id: 'someone-else' }]));
  const r1 = ok(run(w, ['resume', '--session', 'sb']));
  assert.deepEqual(r1, { run_id: id, stage: 'INTAKE', supersedes: 'sa', dashboard_url: null });
  assert.equal(consumed(w, p1), 'resumed');
  assert.equal(sessionFile(w, 'sa'), null);
  assert.equal(sessionFile(w, 'sb').run_id, id);
  // Typed takeover while sb is live.
  writeFileSync(w.agents, JSON.stringify([{ sessionId: 'sb' }]));
  say(w, 'sc', `resume ${id}`);
  fails(run(w, ['resume', 'other-id', '--session', 'sc']), 'BAD_ARGS');
  const r2 = ok(run(w, ['resume', id, '--session', 'sc']));
  assert.equal(r2.supersedes, 'sb');
  const sb = commands(w, id).at(-1);
  assert.equal(sb.kind, 'session_bound');
  assert.deepEqual({ session: sb.data.session, supersedes: sb.data.supersedes }, { session: 'sc', supersedes: 'sb' });
  assert.equal(sb.data.prompt_text.data.prompt, `/factory resume ${id}`);
  assert.equal(sessionFile(w, 'sb'), null);
  fails(run(w, ['next', '--session', 'sb']), 'NOT_HOLDER');
  assert.equal(ok(run(w, ['next', '--session', 'sc'])).steps.length, 1);
  // An unreadable agents list counts the holder as live.
  rmSync(w.agents);
  say(w, 'sd', '');
  fails(run(w, ['resume', '--session', 'sd']), 'CLAIM_TAKEN');
});

test('resolution: the worktree run, else the single live run, else a list; unknown ids are NOT_FOUND', () => {
  const w = world();
  say(w, 'sx', '');
  assert.deepEqual(ok(run(w, ['decide', '--session', 'sx'])).resolution, { none: true });
  assert.deepEqual(ok(run(w, ['resume', '--session', 'sx'])), { none: true });
  const r1 = started(w, 'sa', 'first task');
  say(w, 'sx', '');
  assert.equal(ok(run(w, ['decide', '--session', 'sx'])).resolution.run_id, r1);
  const r2 = started(w, 'sb', 'second task');
  say(w, 'sx', '');
  const list = ok(run(w, ['decide', '--session', 'sx'])).resolution.list;
  assert.deepEqual(list.map((x: any) => x.run_id).sort(), [r1, r2].sort());
  for (const x of list) { assert.equal(x.stage, 'INTAKE'); assert.equal(typeof x.last_ts, 'string'); }
  // Each row reads `run id · title · stage · slice · last activity`: the title is the task, no live slice is `—`.
  assert.deepEqual(list.map((x: any) => Object.keys(x)), [['run_id', 'title', 'stage', 'slice', 'last_ts'], ['run_id', 'title', 'stage', 'slice', 'last_ts']]);
  assert.deepEqual(list.map((x: any) => [x.run_id, x.title, x.slice]).sort(), [[r1, 'first task', '—'], [r2, 'second task', '—']].sort());
  assert.deepEqual(ok(run(w, ['resume', '--session', 'sx'])).list.length, 2);
  // Inside the worktree of r1.
  const wt = join(w.repo, '.claude', 'worktrees', `factory-${r1}`, 'src');
  mkdirSync(wt, { recursive: true });
  assert.equal(ok(run(w, ['decide', '--session', 'sx'], { cwd: wt })).resolution.run_id, r1);
  const bad = join(w.repo, '.claude', 'worktrees', 'factory-nope-zzzz');
  mkdirSync(bad, { recursive: true });
  fails(run(w, ['decide', '--session', 'sx'], { cwd: bad }), 'NOT_FOUND');
  say(w, 'sx', 'resume nope-zzzz');
  fails(run(w, ['decide', '--session', 'sx']), 'NOT_FOUND');
  // Holder verbs use the session's own binding when several runs are live.
  assert.equal(ok(run(w, ['status', '--session', 'sb'])).run_id, r2);
  fails(run(w, ['status', 'nope-zzzz', '--session', 'sb']), 'NOT_FOUND');
});

function runAsync(w: World, args: string[]): Promise<{ code: number | null; out: any; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const c = spawn(BIN, args, { cwd: w.repo, env: childEnv(w) });
    let out = '';
    c.stdout.on('data', (b) => { out += b; });
    c.on('close', (code) => resolve({ code, out: JSON.parse(out), ms: Date.now() - t0 }));
  });
}

test('next --wait sleeps until the wait ends; a log change that issues nothing keeps it asleep; one that issues steps wakes it; a terminal run answers done', async () => {
  const w = world();
  const id = started(w, 'sa');
  const step = ok(run(w, ['next', '--session', 'sa'])).steps[0];
  ok(run(w, ['claim', step.step_id, '--session', 'sa']));
  assert.deepEqual(ok(run(w, ['next', '--wait', '5000', '--session', 'sa'])), { steps: [], in_flight: [step.step_id] }, 'only a card in flight: no wait');
  // Background work in flight (a claimed agent step, appended as the CLI would): the wait applies.
  const bg = ulid();
  appendLine(runFile(w, id), { v: 1, id: bg, ts: new Date().toISOString(), run: id, kind: 'step_issued', actor: 'cli', corr: bg, data: { kind: 'spawn', stage: 'INTAKE', attempt: 1, role: 'recon', agent: 'd2t-factory:recon' } });
  ok(run(w, ['claim', bg, '--session', 'sa']));
  const idle = await runAsync(w, ['next', '--wait', '400', '--session', 'sa']);
  assert.ok(idle.ms >= 400, `returned after ${idle.ms}ms`);
  assert.deepEqual(idle.out.in_flight, [step.step_id, bg]);
  const waiting = runAsync(w, ['next', '--wait', '8000', '--session', 'sa']);
  await new Promise((r) => setTimeout(r, 600));
  // A new fact line changes the logs but issues nothing: still asleep.
  const facts = join(runFile(w, id, ''), 'facts');
  mkdirSync(facts, { recursive: true });
  appendFileSync(join(facts, 'other.jsonl'), '{}\n');
  await new Promise((r) => setTimeout(r, 600));
  writeFileSync(step.output_path, intakeOut());
  const t0 = Date.now();
  ok(run(w, ['done', step.step_id, '--session', 'sa']));
  const woke = await waiting;
  assert.equal(woke.code, 0);
  assert.ok(woke.ms >= 1200 && woke.ms < 6000, `took ${woke.ms}ms`);
  assert.ok(Date.now() - t0 < 4000);
  assert.deepEqual(woke.out.steps.map((x: any) => x.card.commands), [['/factory approve intake']], 'woke by the confirm card');
  for (const bad of ['soon', '', '1e3', '9e15', '-5', '99999999999999999']) fails(run(w, ['next', `--wait=${bad}`, '--session', 'sa']), 'BAD_ARGS');
  say(w, 'sa', 'abandon');
  assert.equal(ok(run(w, ['decide', '--session', 'sa'])).phase, 'ABANDONED');
  assert.deepEqual(ok(run(w, ['next', '--wait', '5000', '--session', 'sa'])), { done: true });
  assert.equal(commands(w, id).at(-1).kind, 'run_abandoned');
});

test('wake: with only a builder in flight, retry_after_ms runs to the cut point, and next --wait returns there with the cut card raised', async () => {
  const w = world();
  const id = started(w, 'sa');
  // The run at BUILD with S1 building and S2 in Backlog, its intake confirmed with a cut point 5 s
  // ahead: appended as the CLI and decide would (the front half is pipeline.test's business).
  const now = Date.now();
  const clock = new Date(now - 60 * 60_000 + 5000).toISOString(); // limit 100 min: cut at clock + 60 min
  const file = runFile(w, id);
  const put = (kind: string, data: object, o: { actor?: string; session?: string } = {}): string => {
    const e = { v: 1, id: ulid(), ts: new Date().toISOString(), run: id, ...(o.session ? { session: o.session } : {}), kind, actor: o.actor ?? 'cli', corr: id, data };
    assert.ok(validateEvent(e).ok, JSON.stringify(e));
    appendLine(file, e);
    return e.id;
  };
  const human = { actor: 'human', session: 'sa' };
  put('intake_confirmed', { prompt_fact_id: 'f', intake: { limit_min: 100, slice_timebox_min: 30, ui_free: false, reviewer_overrides: { add: [], remove: [] } }, clock_start: clock }, human);
  put('stage_completed', { stage: 'RECON' });
  const sc = put('step_issued', { kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder', agent: 'd2t-factory:scaffolder' });
  put('step_claimed', { step_id: sc }, { session: 'sa' });
  put('step_verified', { step_id: sc, evidence: [] });
  put('gate_1_passed', { prompt_fact_id: 'f' }, human);
  put('gate_2_passed', { prompt_fact_id: 'f', slices: [{ id: 'S1', title: 'one', acs: ['AC-1'] }, { id: 'S2', title: 'two', acs: ['AC-2'] }] }, human);
  put('slice_started', { slice: 'S1' });
  const b = put('step_issued', { kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'builder', agent: 'd2t-factory:builder', slice: 'S1' });
  put('step_claimed', { step_id: b }, { session: 'sa' });
  const n = ok(run(w, ['next', '--session', 'sa']));
  assert.deepEqual([n.steps, n.in_flight], [[], [b]]);
  assert.ok(n.wait.retry_after_ms > 0 && n.wait.retry_after_ms <= 5000, `retry_after_ms ${n.wait.retry_after_ms}`);
  const woke = await runAsync(w, ['next', '--wait', String(WAIT_MAX_MS), '--session', 'sa']);
  assert.ok(Date.now() >= now + 5000, 'not before the cut point');
  assert.ok(woke.ms < 9000, `took ${woke.ms}ms`);
  assert.deepEqual(woke.out.steps.map((x: any) => [x.kind, x.card.title]), [['ask_human', 'Cut point reached — 1 slice unbuilt. Cut S2?']]);
  assert.deepEqual(woke.out.in_flight, [b], 'the builder works on: only S2 waits');
  // Only a Backlog slice can be cut; the decision closes the card, verifies its step, and the cut is
  // never raised again.
  const p = say(w, 'sa', 'cut S1');
  fails(run(w, ['decide', '--session', 'sa']), 'ILLEGAL_TRANSITION', /slice S1 is BUILDING; only Backlog slices can be cut/);
  assert.equal(consumed(w, p), 'illegal');
  say(w, 'sa', 'cut S2');
  const d = ok(run(w, ['decide', '--session', 'sa']));
  assert.deepEqual([d.decision, d.phase, d.verified], ['cut_decided', 'BUILD', [woke.out.steps[0].step_id]]);
  const n2 = ok(run(w, ['next', '--session', 'sa']));
  assert.deepEqual([n2.steps, n2.in_flight, n2.wait.retry_after_ms], [[], [b], WAIT_MAX_MS]);
  assert.equal(commands(w, id).filter((e) => e.kind === 'ask_raised').length, 1);
  say(w, 'sa', 'keep');
  fails(run(w, ['decide', '--session', 'sa']), 'ILLEGAL_TRANSITION', /no open cut card/);
});

test('wake (3-4): with a live slice whose time box ends within WAIT_MAX_MS, retry_after_ms is no later than the box end', () => {
  const w = world();
  const id = started(w, 'sa');
  const now = Date.now();
  const file = runFile(w, id);
  const put = (kind: string, data: object, o: { actor?: string; session?: string; ts?: number } = {}): string => {
    const e = { v: 1, id: ulid(), ts: new Date(o.ts ?? Date.now()).toISOString(), run: id, ...(o.session ? { session: o.session } : {}), kind, actor: o.actor ?? 'cli', corr: id, data };
    assert.ok(validateEvent(e).ok, JSON.stringify(e));
    appendLine(file, e);
    return e.id;
  };
  const human = { actor: 'human', session: 'sa' };
  // A 10-hour budget (no cut point near), a 30-min box, S1 started 25 min ago: its box ends in 5 min.
  put('intake_confirmed', { prompt_fact_id: 'f', intake: { limit_min: 600, slice_timebox_min: 30, ui_free: false, reviewer_overrides: { add: [], remove: [] } }, clock_start: new Date(now - 30 * 60_000).toISOString() }, human);
  put('stage_completed', { stage: 'RECON' });
  const sc = put('step_issued', { kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder', agent: 'd2t-factory:scaffolder' });
  put('step_claimed', { step_id: sc }, { session: 'sa' });
  put('step_verified', { step_id: sc, evidence: [] });
  put('gate_1_passed', { prompt_fact_id: 'f' }, human);
  put('gate_2_passed', { prompt_fact_id: 'f', slices: [{ id: 'S1', title: 'one', acs: ['AC-1'] }] }, human);
  put('slice_started', { slice: 'S1' }, { ts: now - 25 * 60_000 });
  const b = put('step_issued', { kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'builder', agent: 'd2t-factory:builder', slice: 'S1' });
  put('step_claimed', { step_id: b }, { session: 'sa' });
  const n = ok(run(w, ['next', '--session', 'sa']));
  assert.deepEqual([n.steps, n.in_flight], [[], [b]]);
  const end = now + 5 * 60_000;
  assert.ok(n.wait.retry_after_ms < WAIT_MAX_MS && Date.now() + n.wait.retry_after_ms <= end + 1000, `retry_after_ms ${n.wait.retry_after_ms}`);
  assert.ok(n.wait.retry_after_ms > 4 * 60_000, `retry_after_ms ${n.wait.retry_after_ms}`);
});

test('every verb but setup requires --session, and it must match CLAUDE_CODE_SESSION_ID', () => {
  const w = world();
  for (const verb of ['start', 'resume', 'status', 'next', 'claim', 'done', 'decide']) {
    fails(run(w, [verb]), 'BAD_ARGS', /--session/);
    fails(run(w, [verb, '--session', 'sa'], { env: { CLAUDE_CODE_SESSION_ID: 'sz' } }), 'BAD_ARGS', /CLAUDE_CODE_SESSION_ID/);
  }
  fails(run(w, ['status', '--session', '../etc']), 'BAD_ARGS');
  say(w, 'sa', 'add login');
  ok(run(w, ['start', '--session', 'sa'], { env: { CLAUDE_CODE_SESSION_ID: 'sa' } }));
});

test('a session that holds a live run cannot start or resume another one', () => {
  const w = world();
  const r1 = started(w, 'sa', 'first task');
  say(w, 'sa', 'second task');
  fails(run(w, ['start', '--session', 'sa']), 'BAD_ARGS', new RegExp(`holds live run ${r1}.*abandon`));
  const r2 = started(w, 'sb', 'other task');
  const p = say(w, 'sa', `resume ${r2}`);
  fails(run(w, ['resume', r2, '--session', 'sa']), 'BAD_ARGS', new RegExp(`holds live run ${r1}`));
  assert.equal(consumed(w, p), null);
  assert.equal(sessionFile(w, 'sa').run_id, r1);
  // Resuming the run it already holds stays allowed.
  say(w, 'sa', `resume ${r1}`);
  assert.equal(ok(run(w, ['resume', r1, '--session', 'sa'])).run_id, r1);
  // Once that run is terminal, the session may start again.
  say(w, 'sa', 'abandon');
  assert.equal(ok(run(w, ['decide', '--session', 'sa'])).phase, 'ABANDONED');
  say(w, 'sa', 'third task');
  ok(run(w, ['start', '--session', 'sa']));
});

// The repo's exclusive claim (AD-15) as SCAFFOLD leaves it: `<hash>/exclusive/run` naming its run.
function holdExclusive(w: World, runId: string): string {
  process.env.FACTORY_HOME = w.home;
  try {
    const hash = commands(w, runId)[0].data.repo_hash;
    mkdirSync(exclusiveDir(hash), { recursive: true });
    writeFileSync(exclusiveOwnerFile(hash), runId + '\n');
    return exclusiveDir(hash);
  } finally {
    delete process.env.FACTORY_HOME;
  }
}

test('start while a live run holds the exclusive claim: REFUSED_EXCLUSIVE naming it, no run dir, no binding, the prompt unconsumed; abandon releases the claim', () => {
  const w = world();
  const a = started(w, 'sa', 'first task');
  const runs = readdirSync(runFile(w, a, '..'));
  const excl = holdExclusive(w, a);
  const p = say(w, 'sb', 'second task');
  const r = run(w, ['start', '--session', 'sb']);
  fails(r, 'REFUSED_EXCLUSIVE');
  assert.equal(r.out.error.message, `Run refused — ${a} is live in this repo and its run contract lists a shared database. One run per repo.`);
  assert.deepEqual(readdirSync(runFile(w, a, '..')), runs, 'no run dir was claimed');
  assert.equal(consumed(w, p), null);
  assert.equal(sessionFile(w, 'sb'), null);
  assert.equal(existsSync(excl), true);
  say(w, 'sa', 'abandon');
  assert.equal(ok(run(w, ['decide', '--session', 'sa'])).phase, 'ABANDONED');
  assert.equal(existsSync(excl), false, 'released once run_abandoned is on disk');
  // The same prompt now starts.
  const b = ok(run(w, ['start', '--session', 'sb'])).run_id;
  assert.equal(consumed(w, p), 'started');
  assert.notEqual(b, a);
});

test('a stale exclusive claim (its run terminal, or gone) is broken and does not refuse start', () => {
  const w = world();
  const a = started(w, 'sa', 'first task');
  say(w, 'sa', 'abandon');
  ok(run(w, ['decide', '--session', 'sa']));
  const excl = holdExclusive(w, a); // left behind, as by a crash before the release
  const b = started(w, 'sb', 'second task');
  assert.ok(b);
  assert.equal(existsSync(excl), false, 'the terminal run\'s claim was broken');
  assert.deepEqual(readdirSync(join(excl, '..')).filter((n) => n.startsWith('exclusive')), [], 'nothing left aside');
  // An owner run that no longer exists.
  mkdirSync(excl);
  writeFileSync(join(excl, 'run'), 'gone-zzzz\n');
  assert.ok(started(w, 'sc', 'third task'));
  assert.equal(existsSync(excl), false);
  // A live owner still refuses.
  holdExclusive(w, b);
  say(w, 'sd', 'fourth task');
  fails(run(w, ['start', '--session', 'sd']), 'REFUSED_EXCLUSIVE', new RegExp(`^Run refused — ${b} is live`));
});

test('after a typed takeover, done on a step the old session claimed is CLAIM_TAKEN', () => {
  const w = world();
  const id = started(w, 'sa');
  const step = ok(run(w, ['next', '--session', 'sa'])).steps[0].step_id;
  ok(run(w, ['claim', step, '--session', 'sa']));
  say(w, 'sb', `resume ${id}`);
  ok(run(w, ['resume', id, '--session', 'sb']));
  fails(run(w, ['done', step, '--note', 'x', '--session', 'sb']), 'CLAIM_TAKEN');
  assert.equal(commands(w, id).some((e) => e.kind === 'step_reported'), false);
});

test('a decision with no matching run is consumed as no_run and fails NOT_FOUND', () => {
  const w = world();
  const p1 = say(w, 'sa', 'approve intake');
  fails(run(w, ['decide', '--session', 'sa']), 'NOT_FOUND');
  assert.equal(consumed(w, p1), 'no_run');
  started(w, 'sa');
  const p2 = say(w, 'sa', 'abandon nope-zzzz');
  fails(run(w, ['decide', '--session', 'sa']), 'NOT_FOUND');
  assert.equal(consumed(w, p2), 'no_run');
});

test('with two live runs, a decision lands on the deciding session\'s own run', () => {
  const w = world();
  const ra = started(w, 'sa', 'first task');
  const rb = started(w, 'sb', 'second task');
  recordIntake((args) => ok(run(w, args)), 'sb');
  say(w, 'sb', 'approve intake');
  assert.equal(ok(run(w, ['decide', '--session', 'sb'])).run_id, rb);
  assert.equal(commands(w, rb).some((e) => e.kind === 'intake_confirmed'), true);
  assert.equal(commands(w, ra).some((e) => e.kind === 'intake_confirmed'), false);
});

test('a verb inside a real git worktree resolves to that worktree\'s run', () => {
  const w = world();
  const r1 = started(w, 'sa', 'first task');
  started(w, 'sb', 'second task');
  const wt = join(w.repo, '.claude', 'worktrees', `factory-${r1}`);
  execFileSync('git', ['worktree', 'add', '-q', '-b', `factory/${r1}`, wt], { cwd: w.repo, stdio: 'ignore' });
  say(w, 'sx', '');
  assert.equal(ok(run(w, ['decide', '--session', 'sx'], { cwd: wt })).resolution.run_id, r1);
  assert.equal(ok(run(w, ['status', '--session', 'sb'], { cwd: wt })).run_id, r1);
});

test('an object-shaped agents list is read for liveness', () => {
  const w = world();
  const id = started(w, 'sa');
  writeFileSync(w.agents, JSON.stringify({ agents: [{ sessionId: 'sa' }] }));
  say(w, 'sb', '');
  fails(run(w, ['resume', '--session', 'sb']), 'CLAIM_TAKEN');
  writeFileSync(w.agents, JSON.stringify({ agents: [{ sessionId: 'other' }] }));
  assert.equal(ok(run(w, ['resume', '--session', 'sb'])).supersedes, 'sa');
  assert.equal(commands(w, id).at(-1).data.session, 'sb');
});
