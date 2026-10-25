// End-to-end tests of the pipeline through bin/factory on a temp brownfield repo with real
// package.json test and health scripts: the 1-4 front half, then 1-5's build loop, WRAP, merge,
// housekeeping and recording. The tests play the conductor and its agents; agent facts come from
// the real 1-3 hooks. The dev server binds a local port (tests that need it are skipped without).
import { strict as assert } from 'node:assert';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { validateEvent } from '../src/core/events.ts';
import { projectRun } from '../src/core/projection.ts';
import { fold } from '../src/core/reducer.ts';
import { mayStop } from '../src/core/stop.ts';
import {
  agentStops, agentWrites, approveOut, builderOut, commands, consumed, contract, decide, designOut, fails, findingsOut, git, ok, questionBlock, reconOut, recordIntake, run, runDir, say,
  scaffoldOut, SECRET, serveBoard, slicerOut, specOut, world, type World, type PlanSlice,
} from './harness.ts';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

// The health check needs a dev server listening on a local port; some sandboxes forbid that (EPERM).
const canListen = await new Promise<boolean>((resolve) => {
  const srv = createServer();
  srv.once('error', () => resolve(false));
  srv.listen(0, '127.0.0.1', () => srv.close(() => resolve(true)));
});
const SERVER = { skip: canListen ? false : 'local port binding is not permitted here (the dev server cannot listen)' };

// The conductor's moves, for one session.
function conductor(w: World, s: string) {
  const opt = (cwd?: string) => (cwd ? { cwd } : {});
  const c = {
    cwd: undefined as string | undefined,
    next: (): any => ok(run(w, ['next', '--session', s], opt(c.cwd))),
    claim: (id: string): any => ok(run(w, ['claim', id, '--session', s], opt(c.cwd))),
    done: (id: string) => run(w, ['done', id, '--session', s], opt(c.cwd)),
    check: (id: string): any => ok(run(w, ['check', id, '--session', s], opt(c.cwd))),
    // The one issued step matching `pred`, claimed.
    take(pred: (st: any) => boolean): any {
      const n = c.next();
      const st = n.steps.find(pred);
      assert.ok(st, `no matching step in ${JSON.stringify(n)}`);
      c.claim(st.step_id);
      return st;
    },
    // An agent writes its output and stops (both through the hooks); then the conductor's done.
    agent(st: any, text: string, agentId: string) {
      agentWrites(w, s, st, text, agentId);
      agentStops(w, s, st.agent, agentId);
      return c.done(st.step_id);
    },
    // Claim and run every issued run_check, in order.
    checks(): any[] {
      const n = c.next();
      const runs = n.steps.filter((st: any) => st.kind === 'run_check');
      assert.ok(runs.length, `no run_check in ${JSON.stringify(n)}`);
      return runs.map((st: any) => { c.claim(st.step_id); return { ...c.check(st.step_id), name: st.check, out: st.output_path }; });
    },
    // SLICE_PLAN (3-3): the slicer writes its plan, then plan.lint runs. Returns the slicer step.
    plan(slices?: PlanSlice[], agentId = 'ag-slicer'): any {
      const sl = c.take(byKind('spawn', 'slicer'));
      assert.equal(ok(c.agent(sl, slicerOut(slices), agentId)).state, 'verified');
      assert.deepEqual(c.checks().map((x) => [x.name, x.passed]), [['plan.lint', true]]);
      return sl;
    },
    // WRAP: contract.health (it restarts the dev server), then contract.test once health is in.
    wrapChecks(): any[] {
      const health = c.checks();
      assert.deepEqual(health.map((x) => x.name), ['contract.health']);
      return [...health, ...c.checks()];
    },
  };
  return c;
}

const byKind = (kind: string, agent?: string) => (st: any): boolean => st.kind === kind && (!agent || st.agent === `d2t-factory:${agent}`);
const card = (type: string) => (st: any): boolean => st.kind === 'ask_human' && st.card?.type === type;
const stateOf = (w: World, id: string) => fold(commands(w, id));
const portOf = (w: World, id: string): number => commands(w, id).find((e) => e.kind === 'stage_started').data.port;
const last = (w: World, id: string, kind: string): any => commands(w, id).filter((e) => e.kind === kind).at(-1);

// The intake marks the task UI-free unless a test says otherwise, so no designer runs (3-2): the
// front-half and build tests keep their spec-only gate 1.
function started(w: World, s: string, task = 'add a footer', intake: Record<string, unknown> = {}) {
  say(w, s, task);
  const id = ok(run(w, ['start', '--session', s])).run_id;
  const c = conductor(w, s);
  recordIntake((a) => ok(run(w, a)), s, { ui_free: true, ...intake });
  assert.equal(ok(decide(w, s, 'approve intake')).phase, 'ORIENT');
  return { id, c };
}

// start → intake → RECON verified → the worktree exists and enter_worktree is claimed and done.
function toScaffold(w: World, s: string, t?: TestContext, intake: Record<string, unknown> = {}) {
  const r = started(w, s, undefined, intake);
  if (t) t.after(() => { run(w, ['devserver', 'down', '--session', s]); });
  const recon = r.c.take(byKind('spawn', 'recon'));
  assert.equal(ok(r.c.agent(recon, reconOut(), 'ag-recon')).state, 'verified');
  const enter = r.c.take(byKind('enter_worktree'));
  r.c.cwd = enter.path;
  assert.equal(ok(r.c.done(enter.step_id)).state, 'verified');
  return { ...r, wt: enter.path as string, port: portOf(w, r.id) };
}

// … → scaffolder DONE → health + test pass → SPEC.
function toSpec(w: World, s: string, t: TestContext) {
  const r = toScaffold(w, s, t);
  const sc = r.c.take(byKind('spawn', 'scaffolder'));
  assert.equal(ok(r.c.agent(sc, scaffoldOut(contract(r.port)), 'ag-scaffold')).state, 'reported');
  assert.deepEqual(r.c.checks().map((x) => [x.name, x.passed]), [['contract.health', true], ['contract.test', true]]);
  return r;
}

test('acceptance: the whole front half through bin/factory ends in BUILD with S1, pinned gates and an untouched main checkout', SERVER, (t) => {
  const w = world();
  const s = 'sa';
  const before = git(w.repo, 'status', '--porcelain=v2');
  const { id, c } = started(w, s);

  // RECON: a CLI-written brief that names the repo; the verified output becomes the cache.
  const recon = c.take(byKind('spawn', 'recon'));
  t.after(() => { run(w, ['devserver', 'down', '--session', s]); });
  const brief = readFileSync(recon.brief_path, 'utf8');
  assert.ok(brief.includes(w.repo) && brief.includes(recon.output_path) && brief.includes('add a footer'), brief);
  assert.equal(ok(c.agent(recon, reconOut(), 'ag-recon')).state, 'verified');

  // ORIENT ends, SCAFFOLD starts: cache, baseline, stage_completed, port, worktree, enter_worktree.
  const enter = c.take(byKind('enter_worktree'));
  const sc1 = last(w, id, 'stage_completed');
  assert.equal(sc1.data.stage, 'RECON');
  assert.deepEqual(sc1.data.recon.context, { origin: 'brownfield', ui_surface: true });
  assert.equal(readFileSync(sc1.data.recon.path, 'utf8'), reconOut());
  assert.equal(sc1.data.recon.sha256, sha(reconOut()));
  const ss = last(w, id, 'stage_started');
  assert.deepEqual({ stage: ss.data.stage, worktree: ss.data.worktree }, { stage: 'SCAFFOLD', worktree: join(w.repo, '.claude', 'worktrees', `factory-${id}`) });
  assert.equal(enter.path, ss.data.worktree);
  assert.ok(existsSync(join(w.home, 'ports', String(ss.data.port))));
  assert.match(readFileSync(join(w.repo, '.git', 'info', 'exclude'), 'utf8'), /^\.claude\/worktrees\/$/m);
  assert.equal(git(enter.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), `factory/${id}`);
  c.cwd = enter.path; // EnterWorktree
  assert.equal(ok(c.done(enter.step_id)).state, 'verified');

  // SCAFFOLD: the contract echoes the claimed port; .env is copied and redacted; checks pass.
  const sc = c.take(byKind('spawn', 'scaffolder'));
  assert.match(readFileSync(sc.brief_path, 'utf8'), new RegExp(`claimed port: ${ss.data.port}`));
  assert.equal(ok(c.agent(sc, scaffoldOut(contract(ss.data.port)), 'ag-scaffold')).state, 'reported');
  assert.equal(readFileSync(join(enter.path, '.env'), 'utf8'), `API_TOKEN=${SECRET}\n`);
  assert.deepEqual(JSON.parse(readFileSync(join(runDir(w, id), 'redact.json'), 'utf8')).values, [SECRET]);
  const checks = c.checks();
  assert.deepEqual(checks.map((x) => [x.name, x.passed]), [['contract.health', true], ['contract.test', true]]);
  assert.ok(existsSync(join(runDir(w, id), 'devserver.pid')) && existsSync(join(runDir(w, id), 'devserver.log')));

  // SPEC, then spec.lint, then the gate_1 card.
  const sw1 = c.take(byKind('spawn', 'spec-writer'));
  const v = commands(w, id).filter((e) => e.kind === 'check_ran').map((e) => [e.data.check, e.data.exit_code]);
  assert.deepEqual(v.slice(-4), [['contract.health', 0], ['contract.test', 0], ['git.worktree_clean', 0], ['git.baseline', 0]]);
  assert.equal(stateOf(w, id).steps[sc.step_id].state, 'verified');
  assert.equal(ok(c.agent(sw1, specOut('Footer'), 'ag-spec-1')).state, 'verified');
  assert.deepEqual(c.checks().map((x) => [x.name, x.passed]), [['spec.lint', true]]);
  const g1 = c.take(card('gate_1'));
  assert.match(g1.card.reason, /1 assumption to check/);
  assert.ok(g1.card.reason.includes(sw1.output_path));

  // rework gate1 → a fresh spec-writer with the note and the prior spec → spec.lint → gate 1 again.
  const rw1 = ok(decide(w, s, 'rework gate1 make the footer grey', { cwd: c.cwd }));
  assert.deepEqual(rw1.verified, [g1.step_id]);
  const rwe = last(w, id, 'rework_requested');
  const lint1 = commands(w, id).filter((e) => e.kind === 'check_ran' && e.data.check === 'spec.lint').at(-1);
  assert.ok(rwe.data.voids.includes(sw1.step_id) && rwe.data.voids.includes(lint1.id), JSON.stringify(rwe.data.voids));
  const sw2 = c.take(byKind('spawn', 'spec-writer'));
  assert.equal(sw2.attempt, 2);
  const brief2 = readFileSync(sw2.brief_path, 'utf8');
  assert.ok(brief2.includes('make the footer grey') && brief2.includes(sw1.output_path), brief2);
  const spec2 = specOut('Grey footer', ['The footer is grey', 'It is on every page']);
  assert.equal(ok(c.agent(sw2, spec2, 'ag-spec-2')).state, 'verified');
  assert.deepEqual(c.checks().map((x) => x.passed), [true]);
  const g1b = c.take(card('gate_1'));
  assert.match(g1b.card.reason, /2 assumptions to check/);
  const a1 = ok(decide(w, s, 'approve gate1', { cwd: c.cwd }));
  assert.deepEqual({ phase: a1.phase, verified: a1.verified }, { phase: 'SLICE_PLAN', verified: [g1b.step_id] });

  // slicer → plan.lint → gate_2 → rework gate2 → a fresh slicer with the note and the previous plan → plan.lint → gate_2 → approve.
  const sl1 = c.plan([{ id: 'S1', title: 'Footer markup', acs: ['AC-1'] }, { id: 'S2', title: 'Footer text', acs: ['AC-2'], depends_on: ['S1'] }], 'ag-slicer-1');
  const g2a = c.take(card('gate_2'));
  assert.equal(g2a.card.reason, '2 slices: S1 Footer markup (AC-1) · code; S2 Footer text (AC-2) ← S1 · code');
  ok(decide(w, s, 'rework gate2 keep it to one small slice', { cwd: c.cwd }));
  assert.ok(last(w, id, 'rework_requested').data.voids.includes(sl1.step_id), 'the slicer step is voided');
  const sl2 = c.take(byKind('spawn', 'slicer'));
  assert.equal(sl2.attempt, 2);
  const sbrief = readFileSync(sl2.brief_path, 'utf8');
  assert.ok(sbrief.includes('keep it to one small slice') && sbrief.includes(sl1.output_path) && sbrief.includes(sw2.output_path), sbrief);
  const plan2 = slicerOut();
  assert.equal(ok(c.agent(sl2, plan2, 'ag-slicer-2')).state, 'verified');
  assert.deepEqual(c.checks().map((x) => [x.name, x.passed]), [['plan.lint', true]]);
  const g2 = c.take(card('gate_2'));
  assert.equal(g2.card.reason, '1 slice: S1 add a footer (AC-1, AC-2) · code');
  assert.equal(ok(decide(w, s, 'approve gate2', { cwd: c.cwd })).phase, 'BUILD');

  const state = stateOf(w, id);
  assert.equal(state.phase, 'BUILD');
  assert.deepEqual(state.slices.S1, { id: 'S1', title: 'add a footer', acs: ['AC-1', 'AC-2'], notes: undefined, deps: [], state: 'BACKLOG', rounds: 0, tags: [], roster: ['reviewer-code'] });
  const pin = { path: sw2.output_path, sha256: sha(spec2) };
  assert.deepEqual(last(w, id, 'gate_1_passed').data.pins, [pin]);
  assert.deepEqual(last(w, id, 'gate_2_passed').data.pins, [pin, { path: sl2.output_path, sha256: sha(plan2) }]);
  assert.deepEqual(last(w, id, 'gate_2_passed').data.slices, [{ id: 'S1', title: 'add a footer', acs: ['AC-1', 'AC-2'], tags: [], deps: [], roster: ['reviewer-code'] }]);
  assert.equal(git(w.repo, 'status', '--porcelain=v2'), before, 'the main checkout is untouched');
  assert.equal(commands(w, id)[2].data.digest, sha(before));
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(state.rejected, []);
  assert.ok(!readFileSync(join(runDir(w, id), 'commands.jsonl'), 'utf8').includes(SECRET), 'no copied secret reaches the log');
});

test('RECON cache hit: a second run on the same base commit spawns no recon and embeds the cached context; next from inside verifies enter_worktree', () => {
  const w = world();
  const r1 = started(w, 'sa');
  const recon = r1.c.take(byKind('spawn', 'recon'));
  ok(r1.c.agent(recon, reconOut(), 'ag-recon'));
  r1.c.next(); // completes ORIENT, publishes the cache
  ok(decide(w, 'sa', 'abandon'));
  assert.equal(existsSync(join(w.home, 'ports', String(portOf(w, r1.id)))), false, 'abandon released the port');

  const r2 = started(w, 'sb', 'add a header');
  const n = r2.c.next();
  assert.deepEqual(n.steps.map((x: any) => x.kind), ['enter_worktree'], 'no recon spawn');
  const done = last(w, r2.id, 'stage_completed');
  assert.deepEqual(done.data.recon.context, { origin: 'brownfield', ui_surface: true });
  assert.equal(done.data.recon.sha256, sha(reconOut()));
  assert.equal(commands(w, r2.id).some((e) => e.kind === 'step_issued' && e.data.role === 'recon'), false);
  // done from outside the worktree (EnterWorktree failed): MISSING_EVIDENCE, and the step is reissued.
  r2.c.claim(n.steps[0].step_id);
  fails(r2.c.done(n.steps[0].step_id), 'MISSING_EVIDENCE', /outside the worktree/);
  assert.equal(last(w, r2.id, 'step_reissued').data.old, n.steps[0].step_id);
  const again = r2.c.next().steps[0];
  assert.deepEqual([again.kind, again.attempt], ['enter_worktree', 2]);
  // The CLI call's own cwd inside the worktree verifies the step, claimed or not.
  r2.c.cwd = again.path;
  const n2 = r2.c.next();
  assert.deepEqual(n2.steps.map((x: any) => x.agent), ['d2t-factory:scaffolder']);
  const evs = commands(w, r2.id).filter((e) => e.corr === again.step_id).map((e) => e.kind);
  assert.deepEqual(evs, ['step_claimed', 'step_verified']);
  ok(decide(w, 'sb', 'abandon', { cwd: r2.c.cwd }));
});

test('agent done: a parse failure is MISSING_EVIDENCE plus a reissue with the error in a fresh brief; late facts verify at next', () => {
  const w = world();
  const { id, c } = started(w, 'sa');
  const r1 = c.take(byKind('spawn', 'recon'));
  writeFileSync(r1.output_path, 'I mapped it, trust me\n');
  fails(c.done(r1.step_id), 'MISSING_EVIDENCE', /line 1 must be/);
  const re = last(w, id, 'step_reissued');
  assert.equal(re.data.old, r1.step_id);
  const r2 = c.take(byKind('spawn', 'recon'));
  assert.equal(r2.step_id, re.data.new);
  assert.equal(r2.attempt, 2);
  assert.notEqual(r2.output_path, r1.output_path);
  assert.match(readFileSync(r2.brief_path, 'utf8'), /Your previous output was rejected[\s\S]*line 1 must be/);
  // A schema error is a parse failure too.
  writeFileSync(r2.output_path, 'STATUS: DONE\n---\norigin: somewhere\nui_surface: true\n---\n');
  fails(c.done(r2.step_id), 'MISSING_EVIDENCE', /origin must be brownfield or greenfield/);
  const r3 = c.take(byKind('spawn', 'recon'));
  // Output written, done before the async SubagentStop fact lands: reported, then verified by next.
  agentWrites(w, 'sa', r3, reconOut(), 'ag-3');
  const d = ok(c.done(r3.step_id));
  assert.equal(d.state, 'reported');
  const rep = last(w, id, 'step_reported');
  assert.deepEqual({ status: rep.data.output.status, front: rep.data.output.front, sha: rep.data.output.sha256 }, { status: 'DONE', front: { origin: 'brownfield', ui_surface: true }, sha: sha(reconOut()) });
  assert.deepEqual(c.next().in_flight, [r3.step_id]);
  agentStops(w, 'sa', r3.agent, 'ag-3');
  const n = c.next();
  assert.equal(stateOf(w, id).steps[r3.step_id].state, 'verified');
  assert.equal(last(w, id, 'step_verified').data.evidence.length, 2);
  assert.deepEqual(n.steps.map((x: any) => x.kind), ['enter_worktree']);
  ok(decide(w, 'sa', 'abandon'));
});

test('port range exhausted at SCAFFOLD → LOCKED', () => {
  const w = world();
  const { c } = started(w, 'sa');
  const recon = c.take(byKind('spawn', 'recon'));
  ok(c.agent(recon, reconOut(), 'ag-recon'));
  for (let p = 5100; p <= 5199; p++) mkdirSync(join(w.home, 'ports', String(p)), { recursive: true });
  fails(run(w, ['next', '--session', 'sa']), 'LOCKED', /every port/);
});

test('every port claimed at SCAFFOLD: one whose owner run is abandoned or gone is broken and re-claimed (5-1)', () => {
  const w = world();
  const live = started(w, 'sa').id;
  const abandoned = started(w, 'sb', 'add a header').id;
  ok(decide(w, 'sb', 'abandon'));
  const { id, c } = started(w, 'sc', 'add a sidebar');
  const ports = join(w.home, 'ports');
  for (let p = 5100; p <= 5199; p++) {
    mkdirSync(join(ports, String(p)), { recursive: true });
    writeFileSync(join(ports, String(p), 'run'), `${p === 5150 ? abandoned : p === 5180 ? 'gone-zzzz' : live}\n`);
  }
  const recon = c.take(byKind('spawn', 'recon'));
  ok(c.agent(recon, reconOut(), 'ag-recon'));
  c.take(byKind('enter_worktree'));
  const port = portOf(w, id);
  assert.ok([5150, 5180].includes(port), `took ${port}`);
  assert.equal(readFileSync(join(ports, String(port), 'run'), 'utf8'), `${id}\n`);
  assert.deepEqual(readdirSync(ports).filter((n) => /\.(stale-|break)/.test(n)), [], 'nothing left aside');
  assert.equal(readdirSync(ports).length, 100);
  ok(decide(w, 'sc', 'abandon', { cwd: c.cwd }));
  ok(decide(w, 'sa', 'abandon'));
});

test('scaffold failures: a wrong port raises the card, retry reissues with the note, a failing test raises it again, accept verifies with the failing checks, abandon kills the server and frees the port', SERVER, (t) => {
  const w = world();
  const { id, c, port, wt } = toScaffold(w, 'sa', t);
  const sc1 = c.take(byKind('spawn', 'scaffolder'));
  const d1 = ok(c.agent(sc1, scaffoldOut(contract(port + 1)), 'ag-s1'));
  assert.deepEqual({ state: d1.state, escalation: d1.escalation }, { state: 'reported', escalation: 'E1' });
  const ask1 = last(w, id, 'ask_raised');
  assert.deepEqual({ type: ask1.data.card.type, step: ask1.data.step_id, e: ask1.data.escalation }, { type: 'scaffold_failure', step: sc1.step_id, e: 'E1' });
  assert.match(ask1.data.card.reason, new RegExp(`port ${port + 1} is not the claimed port ${port}`));
  const card1 = c.take(card('scaffold_failure'));
  assert.deepEqual(card1.card.commands, ['/factory rule E1 retry <note…>', '/factory abandon'], 'no accept without a usable contract');
  const bogus = decide(w, 'sa', 'rule E1 shrug', { cwd: wt });
  fails(bogus, 'ILLEGAL_TRANSITION', /the choices are retry <note…>$/);
  assert.equal(consumed(w, bogus.pid), 'illegal');
  fails(decide(w, 'sa', 'rule E1 accept', { cwd: wt }), 'ILLEGAL_TRANSITION');

  const rr = ok(decide(w, 'sa', 'rule E1 retry use the claimed port', { cwd: wt }));
  assert.deepEqual(rr.verified, [card1.step_id]);
  const sc1b = c.take(byKind('spawn', 'scaffolder'));
  assert.equal(sc1b.step_id, rr.reissued);
  const brief1b = readFileSync(sc1b.brief_path, 'utf8');
  assert.match(brief1b, /E1 retry: use the claimed port/);
  assert.match(brief1b, new RegExp(`why it was sent back: run contract port ${port + 1} is not the claimed port ${port}`));
  // A later parse-failure reissue keeps the ruling's note.
  writeFileSync(sc1b.output_path, 'done!\n');
  fails(c.done(sc1b.step_id), 'MISSING_EVIDENCE');
  const sc2 = c.take(byKind('spawn', 'scaffolder'));
  assert.match(readFileSync(sc2.brief_path, 'utf8'), /E1 retry: use the claimed port[\s\S]*Your previous output was rejected/);
  ok(c.agent(sc2, scaffoldOut(contract(port, { test: 'npm test --silent && exit 3' })), 'ag-s2'));
  assert.deepEqual(c.checks().map((x) => [x.name, x.passed]), [['contract.health', true], ['contract.test', false]]);
  const card2 = c.take(card('scaffold_failure'));
  assert.equal(card2.card.escalation, 'E2');
  assert.deepEqual(card2.card.commands, ['/factory rule E2 retry <note…>', '/factory rule E2 accept', '/factory abandon']);
  assert.match(card2.card.reason, /contract\.test failed \(exit 3\)/);
  const failing = commands(w, id).filter((e) => e.kind === 'check_ran' && e.data.exit_code !== 0).map((e) => e.id);
  const acc = ok(decide(w, 'sa', 'rule E2 accept', { cwd: wt }));
  assert.equal(acc.phase, 'SPEC_DESIGN');
  const ver = commands(w, id).find((e) => e.kind === 'step_verified' && e.data.step_id === sc2.step_id);
  assert.ok(failing.every((f) => ver.data.evidence.includes(f)) && failing.length === 1, JSON.stringify(ver.data));

  const pid = JSON.parse(readFileSync(join(runDir(w, id), 'devserver.pid'), 'utf8')).pid;
  assert.doesNotThrow(() => process.kill(pid, 0));
  assert.equal(ok(decide(w, 'sa', 'abandon', { cwd: wt })).phase, 'ABANDONED');
  assert.throws(() => process.kill(pid, 0), 'the dev server is gone');
  assert.equal(existsSync(join(runDir(w, id), 'devserver.pid')), false);
  assert.equal(existsSync(join(w.home, 'ports', String(port))), false);
});

test('a scaffolder ESCALATE raises the scaffold_failure card; Stop may end the turn on it', (t) => {
  const w = world();
  const { id, c } = toScaffold(w, 'sa', t);
  const sc = c.take(byKind('spawn', 'scaffolder'));
  ok(c.agent(sc, 'STATUS: ESCALATE\nScaffold failed: the tests need a database\n', 'ag-s'));
  const crd = c.take(card('scaffold_failure'));
  assert.match(crd.card.reason, /Scaffold failed: the tests need a database/);
  assert.deepEqual(c.next().steps, []);
  const s = stateOf(w, id);
  assert.equal(s.steps[sc.step_id].state, 'reported');
  assert.equal(mayStop(s, []).may, true, 'parked on the card');
});

test('check: HEAD moving while the check runs → ILLEGAL_TRANSITION, no result recorded, the step reissued', (t) => {
  const w = world();
  const { id, c, port } = toScaffold(w, 'sa', t);
  const sc = c.take(byKind('spawn', 'scaffolder'));
  const moving = 'git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q --allow-empty -m moved && npm test --silent';
  ok(c.agent(sc, scaffoldOut(contract(port, { test: moving })), 'ag-s'));
  const steps = c.next().steps.filter((st: any) => st.check === 'contract.test');
  c.claim(steps[0].step_id);
  const before = commands(w, id).length;
  fails(run(w, ['done', steps[0].step_id, '--session', 'sa'], { cwd: c.cwd }), 'BAD_ARGS', /run factory check/);
  fails(run(w, ['check', steps[0].step_id, '--session', 'sa'], { cwd: c.cwd }), 'ILLEGAL_TRANSITION', /HEAD moved[\s\S]*reissued as step/);
  // No check result is recorded; the step is reissued instead of staying claimed forever.
  const after = commands(w, id).slice(before);
  assert.deepEqual(after.map((e) => e.kind), ['step_reissued']);
  assert.equal(after[0].data.old, steps[0].step_id);
  const again = c.next().steps.filter((st: any) => st.check === 'contract.test');
  assert.deepEqual(again.map((st: any) => [st.step_id, st.attempt]), [[after[0].data.new, 2]]);
});

test('gate 1 needs a passing spec.lint of the verified spec bytes; rework needs an open card', SERVER, (t) => {
  const w = world();
  const { id, c } = toSpec(w, 'sa', t);
  const sw = c.take(byKind('spawn', 'spec-writer'));
  ok(c.agent(sw, specOut('Footer', ['The footer is on every page']).replace('## Assumptions', '## Notes'), 'ag-spec'));
  const early = decide(w, 'sa', 'approve gate1', { cwd: c.cwd });
  fails(early, 'ILLEGAL_TRANSITION', /no open gate_1 card/);
  assert.equal(consumed(w, early.pid), 'illegal');
  fails(decide(w, 'sa', 'rework gate1 too early', { cwd: c.cwd }), 'ILLEGAL_TRANSITION', /no open gate_1 card/);
  // A failing lint: the card offers only rework, and approve stays refused.
  assert.deepEqual(c.checks().map((x) => x.passed), [false]);
  const g = c.take(card('gate_1'));
  assert.deepEqual(g.card.commands, ['/factory rework gate1 <note…>']);
  assert.match(g.card.reason, /spec\.lint failed: no Assumptions section/);
  const noLint = decide(w, 'sa', 'approve gate1', { cwd: c.cwd });
  fails(noLint, 'MISSING_EVIDENCE', /no passing spec\.lint/);
  assert.equal(consumed(w, noLint.pid), 'missing_evidence');
  ok(decide(w, 'sa', 'rework gate1 add the Assumptions section', { cwd: c.cwd }));
  const sw2 = c.take(byKind('spawn', 'spec-writer'));
  ok(c.agent(sw2, specOut('Footer'), 'ag-spec-2'));
  assert.deepEqual(c.checks().map((x) => x.passed), [true]);
  c.take(card('gate_1'));
  // Changed after it was linted: the pin no longer matches.
  writeFileSync(sw2.output_path, specOut('Footer') + 'one more line\n');
  fails(decide(w, 'sa', 'approve gate1', { cwd: c.cwd }), 'MISSING_EVIDENCE', /changed since it was verified/);
  writeFileSync(sw2.output_path, specOut('Footer'));
  assert.equal(ok(decide(w, 'sa', 'approve gate1', { cwd: c.cwd })).phase, 'SLICE_PLAN');
  // Gate 2: approve or rework before its card is illegal.
  fails(decide(w, 'sa', 'approve gate2', { cwd: c.cwd }), 'ILLEGAL_TRANSITION', /no open gate_2 card/);
  fails(decide(w, 'sa', 'rework gate2 nope', { cwd: c.cwd }), 'ILLEGAL_TRANSITION');
  fails(decide(w, 'sa', 'rework S1 later', { cwd: c.cwd }), 'ILLEGAL_TRANSITION', /only at an open merge card/);
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, 'sa', 'abandon', { cwd: c.cwd }));
});

test('orphans after a takeover: a stopped agent without output and a claimed enter_worktree are reissued; a running agent is left alone, then verified as is', () => {
  const w = world();
  const { id, c } = started(w, 'sa');
  const takeover = (to: string) => { say(w, to, `resume ${id}`); ok(run(w, ['resume', id, '--session', to])); return conductor(w, to); };
  // sa's recon agent stops without writing anything; sb takes over: reissued with the error.
  const r1 = c.take(byKind('spawn', 'recon'));
  agentStops(w, 'sa', r1.agent, 'ag-lost');
  const b = takeover('sb');
  const r2 = b.take(byKind('spawn', 'recon'));
  assert.equal(last(w, id, 'step_reissued').data.old, r1.step_id);
  assert.match(readFileSync(r2.brief_path, 'utf8'), /no output file/);
  // sb's agent is still running when sc takes over: left alone.
  const cc = takeover('sc');
  assert.deepEqual(cc.next().in_flight, [r2.step_id]);
  assert.equal(stateOf(w, id).steps[r2.step_id].state, 'claimed');
  // Its output and stop land (attribution is by output path and agent_id): verified as is.
  agentWrites(w, 'sc', r2, reconOut(), 'ag-2');
  agentStops(w, 'sc', r2.agent, 'ag-2');
  const n = cc.next();
  assert.equal(stateOf(w, id).steps[r2.step_id].state, 'verified');
  const rep = commands(w, id).find((e) => e.kind === 'step_reported' && e.data.step_id === r2.step_id);
  assert.equal(rep.actor, 'cli');
  assert.equal(rep.data.output.status, 'DONE');
  // A claimed enter_worktree of a superseded session is reissued.
  const enter = n.steps.find((x: any) => x.kind === 'enter_worktree');
  cc.claim(enter.step_id);
  const d = takeover('sd');
  const n2 = d.next();
  assert.equal(last(w, id, 'step_reissued').data.old, enter.step_id);
  assert.deepEqual(n2.steps.map((x: any) => [x.kind, x.attempt]), [['enter_worktree', 2]]);
  ok(decide(w, 'sd', 'abandon'));
});

// … → a scaffolder contract whose dev server needs no port (`sleep`) and whose health is `true`.
function toChecks(w: World, s: string, t: TestContext, o: Record<string, unknown> = {}) {
  const r = toScaffold(w, s, t);
  const sc = r.c.take(byKind('spawn', 'scaffolder'));
  const d = ok(r.c.agent(sc, scaffoldOut(contract(r.port, { start: 'sleep 30', health: 'true', ...o })), 'ag-scaffold'));
  return { ...r, sc, d };
}

test('SCAFFOLD done: a tracked file changed in the worktree raises scaffold_failure', (t) => {
  const w = world();
  const { c, wt } = toChecks(w, 'sa', t);
  assert.deepEqual(c.checks().map((x) => x.passed), [true, true]);
  writeFileSync(join(wt, 'test.js'), "console.log('changed');\n");
  const crd = c.take(card('scaffold_failure'));
  assert.equal(crd.card.reason, 'tracked files changed in the worktree');
  assert.ok(crd.card.commands.includes('/factory rule E1 accept'), 'a parsed contract can be accepted');
});

test('SCAFFOLD done: a main-checkout change since the baseline raises scaffold_failure', (t) => {
  const w = world();
  const { c } = toChecks(w, 'sa', t);
  assert.deepEqual(c.checks().map((x) => x.passed), [true, true]);
  writeFileSync(join(w.repo, 'stray.txt'), 'x\n');
  const crd = c.take(card('scaffold_failure'));
  assert.equal(crd.card.reason, 'the main checkout differs from its baseline');
});

test('copy_gitignored naming a tracked file raises scaffold_failure "is not ignored by git", with no accept', (t) => {
  const w = world();
  const { id, d, c, wt } = toChecks(w, 'sa', t, { copy_gitignored: ['server.js'] });
  assert.equal(d.escalation, 'E1');
  const crd = c.take(card('scaffold_failure'));
  assert.match(crd.card.reason, /copy_gitignored server\.js is not ignored by git/);
  assert.deepEqual(crd.card.commands, ['/factory rule E1 retry <note…>', '/factory abandon']);
  assert.equal(existsSync(join(wt, '.env')), false, 'nothing copied');
  assert.equal(last(w, id, 'step_reported').data.output.failure, 'copy_gitignored server.js is not ignored by git');
});

test('a recon ESCALATE raises an escalation card: accept is refused, retry reissues with the note and the reason', () => {
  const w = world();
  const { id, c } = started(w, 'sa');
  const r1 = c.take(byKind('spawn', 'recon'));
  assert.equal(ok(c.agent(r1, 'STATUS: ESCALATE\nScope change: this repo is two apps\n', 'ag-r1')).escalation, 'E1');
  const crd = c.take(card('escalation'));
  assert.deepEqual({ title: crd.card.title, reason: crd.card.reason, commands: crd.card.commands }, {
    title: 'Scope change (recon)', reason: 'this repo is two apps', commands: ['/factory rule E1 retry <note…>', '/factory abandon'],
  });
  fails(decide(w, 'sa', 'rule E1 accept'), 'ILLEGAL_TRANSITION', /the choices are retry <note…>$/);
  const rr = ok(decide(w, 'sa', 'rule E1 retry map only the web app'));
  assert.deepEqual(rr.verified, [crd.step_id]);
  assert.equal(last(w, id, 'step_reissued').data.old, r1.step_id);
  const r2 = c.take(byKind('spawn', 'recon'));
  assert.equal(r2.step_id, rr.reissued);
  assert.match(readFileSync(r2.brief_path, 'utf8'), /E1 retry: map only the web app\n> \(why it was sent back: this repo is two apps\)/);
  ok(decide(w, 'sa', 'abandon'));
});

test('health as an http URL passes against the running dev server', SERVER, (t) => {
  const w = world();
  const r = toScaffold(w, 'sa', t);
  const sc = r.c.take(byKind('spawn', 'scaffolder'));
  ok(r.c.agent(sc, scaffoldOut(contract(r.port, { health: `http://127.0.0.1:${r.port}/health` })), 'ag-s'));
  assert.deepEqual(r.c.checks().map((x) => [x.name, x.passed]), [['contract.health', true], ['contract.test', true]]);
});

test('a dev server that exits fails health with "the dev server exited"', (t) => {
  const w = world();
  const { c } = toChecks(w, 'sa', t, { start: 'exit 1', health: 'false' });
  const [health] = c.checks();
  assert.deepEqual([health.name, health.passed], ['contract.health', false]);
  assert.match(readFileSync(health.out, 'utf8'), /the dev server exited/);
  assert.match(c.take(card('scaffold_failure')).card.reason, /contract\.health failed \(exit 1\)/);
});

test('a copied secret is redacted in the log and the check output, yet the raw contract runs; HOST=localhost leaves a localhost health intact', SERVER, (t) => {
  const w = world();
  writeFileSync(join(w.repo, '.env'), `API_TOKEN=${SECRET}\nHOST=localhost\nDEBUG=true\nWORKERS=4\n`);
  const r = toScaffold(w, 'sa', t);
  const sc = r.c.take(byKind('spawn', 'scaffolder'));
  const health = `node -e "require('http').get({host:'localhost',family:4,port:process.env.PORT,path:'/health'},(x)=>process.exit(x.statusCode===200?0:1)).on('error',()=>process.exit(1))"`;
  ok(r.c.agent(sc, scaffoldOut(contract(r.port, { test: `grep ${SECRET} .env && npm test --silent`, health })), 'ag-s'));
  assert.deepEqual(JSON.parse(readFileSync(join(runDir(w, r.id), 'redact.json'), 'utf8')).values, [SECRET, 'localhost']);
  const checks = r.c.checks();
  assert.deepEqual(checks.map((x) => [x.name, x.passed]), [['contract.health', true], ['contract.test', true]]);
  const log = readFileSync(join(runDir(w, r.id), 'commands.jsonl'), 'utf8');
  const out = readFileSync(checks[1].out, 'utf8');
  for (const text of [log, out]) {
    assert.ok(text.includes('[REDACTED]'), text);
    assert.ok(!text.includes(SECRET));
  }
});

// --- 1-5: the build loop, WRAP, the merge, housekeeping and the recording ------------------------

const NO_SERVER = { start: 'sleep 30', health: 'true' };
type Run = ReturnType<typeof toScaffold>;

// … → spec → gate 1 → the slicer's plan (one slice S1 by default) → plan.lint → the gate_2 card, claimed. By default the contract's dev server is
// `sleep` and its health `true`, so no port is bound.
function toGate2(w: World, s: string, t: TestContext, o: Record<string, unknown> = NO_SERVER, intake: Record<string, unknown> = {}, slices?: PlanSlice[]) {
  const r = toScaffold(w, s, t, intake);
  const sc = r.c.take(byKind('spawn', 'scaffolder'));
  ok(r.c.agent(sc, scaffoldOut(contract(r.port, o)), 'ag-scaffold'));
  assert.deepEqual(r.c.checks().map((x) => x.passed), [true, true]);
  const spec = r.c.take(byKind('spawn', 'spec-writer'));
  ok(r.c.agent(spec, specOut('Footer'), 'ag-spec'));
  assert.deepEqual(r.c.checks().map((x) => x.passed), [true]);
  r.c.take(card('gate_1'));
  ok(decide(w, s, 'approve gate1', { cwd: r.c.cwd }));
  const slicer = r.c.plan(slices);
  const gate2 = r.c.take(card('gate_2'));
  return { ...r, spec, slicer, gate2 };
}

// … → gate 2 approved: BUILD with S1 in BACKLOG.
function toBuild(w: World, s: string, t: TestContext, o: Record<string, unknown> = NO_SERVER) {
  const r = toGate2(w, s, t, o);
  assert.equal(ok(decide(w, s, 'approve gate2', { cwd: r.c.cwd })).phase, 'BUILD');
  return r;
}

// The builder edits the worktree, writes its output and stops; then the conductor's done.
function builds(r: Run, st: any, files: Record<string, string | null>, agentId: string, out = builderOut('Added the footer')) {
  for (const [f, text] of Object.entries(files)) {
    if (text === null) rmSync(join(r.wt, f), { force: true });
    else writeFileSync(join(r.wt, f), text);
  }
  return r.c.agent(st, out, agentId);
}

const headOf = (dir: string): string => git(dir, 'rev-parse', 'HEAD').trim();
const branchOf = (dir: string): string => git(dir, 'symbolic-ref', '--short', 'HEAD').trim();
const commitIn = (dir: string, file: string, text: string, msg: string): void => {
  writeFileSync(join(dir, file), text);
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', msg);
};

// One passing round: builder → contract.test → reviewer APPROVE; the next `next` closes the slice,
// completes BUILD and issues the WRAP checks. Returns the WRAP checks' results.
function passingRound(r: Run, b: any, files: Record<string, string | null>, agentId: string) {
  ok(builds(r, b, files, agentId));
  assert.deepEqual(r.c.checks().map((x) => [x.name, x.passed]), [['contract.test', true]]);
  const rv = r.c.take(byKind('spawn', 'reviewer-code'));
  assert.equal(ok(r.c.agent(rv, approveOut(), `${agentId}-rv`)).state, 'verified');
  return { rv };
}

test('build: a builder brief, a commit per parsed done (an empty diff too), none on a parse error; a builder ESCALATE parks the slice and retry reissues it', (t) => {
  const w = world();
  const r = toBuild(w, 'sa', t);
  const { id, c, wt } = r;
  const b1 = c.take(byKind('spawn', 'builder'));
  assert.equal(last(w, id, 'slice_started').data.slice, 'S1');
  const brief = readFileSync(b1.brief_path, 'utf8');
  for (const want of [r.spec.output_path, 'acceptance criteria of S1: AC-1, AC-2', `the worktree (product code): ${wt}`, 'run contract from SCAFFOLD', 'slice: S1 add a footer', 'Never commit']) {
    assert.ok(brief.includes(want), `${want} in\n${brief}`);
  }
  assert.ok(!brief.includes('the approved design'), 'no designer ran: no design input');
  // A parse error: no commit, MISSING_EVIDENCE, reissued.
  const head0 = headOf(wt);
  writeFileSync(join(wt, 'footer.js'), 'module.exports = "footer";\n');
  writeFileSync(b1.output_path, 'done\n');
  fails(c.done(b1.step_id), 'MISSING_EVIDENCE', /line 1/);
  assert.equal(headOf(wt), head0, 'nothing committed');
  // ESCALATE parses, so it commits; the slice is ESCALATED behind an escalation card.
  const b2 = c.take(byKind('spawn', 'builder'));
  assert.equal(b2.attempt, 2);
  const d = ok(c.agent(b2, 'STATUS: ESCALATE\nSpec ambiguity: the footer on every page or only the home page?\n', 'ag-b2'));
  assert.equal(d.escalation, 'E1');
  assert.equal(git(wt, 'log', '-1', '--format=%s').trim(), `factory: S1 add a footer (${b2.step_id})`);
  assert.equal(git(wt, 'log', '-1', '--format=%an <%ae>').trim(), 'd2t-factory <factory@localhost>', 'no identity configured: the fallback');
  assert.equal(last(w, id, 'ask_raised').data.slice, 'S1');
  assert.equal(stateOf(w, id).slices.S1.state, 'ESCALATED');
  const crd = c.take(card('escalation'));
  assert.deepEqual(crd.card.commands, ['/factory rule E1 retry <note…>', '/factory abandon']);
  const rr = ok(decide(w, 'sa', 'rule E1 retry every page', { cwd: wt }));
  assert.equal(stateOf(w, id).slices.S1.state, 'BUILDING');
  const b3 = c.take(byKind('spawn', 'builder'));
  assert.equal(b3.step_id, rr.reissued);
  assert.match(readFileSync(b3.brief_path, 'utf8'), /E1 retry: every page/);
  // Nothing changed this time: the commit is still made, empty.
  const before = headOf(wt);
  assert.equal(ok(builds(r, b3, {}, 'ag-b3')).state, 'verified');
  assert.notEqual(headOf(wt), before);
  assert.equal(git(wt, 'show', '--format=', '--name-only', 'HEAD').trim(), '', 'an empty commit');
  const rep = commands(w, id).find((e) => e.kind === 'step_reported' && e.data.step_id === b3.step_id);
  assert.equal(rep.data.sha, headOf(wt));
  assert.equal(rep.data.output.front.summary, 'Added the footer');
  assert.equal(stateOf(w, id).slices.S1.state, 'IN_REVIEW');
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, 'sa', 'abandon', { cwd: wt }));
});

test('rounds: a failing slice test resumes the builder with the log; malformed verdicts are rejected; FINDINGS resume it with the findings; after a takeover the round is a spawn; at the cap Non-convergence, retry buys one round, accept closes', (t) => {
  const w = world();
  const r = toBuild(w, 'sa', t, { ...NO_SERVER, test: 'test ! -f broken.txt && npm test --silent' });
  const { id, c, wt } = r;
  const S = () => stateOf(w, id).slices.S1;
  // Round 0: the slice test fails at the builder's commit.
  const b1 = c.take(byKind('spawn', 'builder'));
  ok(builds(r, b1, { 'footer.js': '1\n', 'broken.txt': 'x\n' }, 'ag-b1'));
  const [test1] = c.checks();
  assert.deepEqual([test1.name, test1.passed], ['contract.test', false]);
  assert.equal(commands(w, id).find((e) => e.id === test1.check_id).data.sha, headOf(wt), 'pinned to the builder sha');
  // Round 1: the same agent, resumed, with the test log in its brief.
  const b2 = c.take(byKind('resume', 'builder'));
  assert.deepEqual([b2.agent_id, S().rounds, S().state], ['ag-b1', 1, 'BUILDING']);
  const brief2 = readFileSync(b2.brief_path, 'utf8');
  assert.ok(brief2.includes(test1.out) && /contract\.test failed \(exit 1\)/.test(brief2), brief2);
  assert.notEqual(b2.output_path, b1.output_path);
  // Round 1's stop (before this claim) never verifies round 2: reported until its own stop lands.
  agentWrites(w, 'sa', b2, builderOut('Removed the stray file'), 'ag-b1');
  rmSync(join(wt, 'broken.txt'));
  assert.equal(ok(c.done(b2.step_id)).state, 'reported');
  agentStops(w, 'sa', b2.agent, 'ag-b1');
  assert.deepEqual(c.checks().map((x) => [x.name, x.passed]), [['contract.test', true]]);
  // The reviewer: a verdict and its findings must agree, in the charter's categories.
  const rv1 = c.take(byKind('spawn', 'reviewer-code'));
  const rbrief = readFileSync(rv1.brief_path, 'utf8');
  assert.ok(rbrief.includes(`git diff ${stateOf(w, id).base_sha}..${headOf(wt)}`) && rbrief.includes(r.spec.output_path) && rbrief.includes('AC-1, AC-2'), rbrief);
  writeFileSync(rv1.output_path, 'VERDICT: FINDINGS\nit is wrong\n');
  fails(c.done(rv1.step_id), 'MISSING_EVIDENCE', /at least one ```finding block/);
  const rv2 = c.take(byKind('spawn', 'reviewer-code'));
  writeFileSync(rv2.output_path, approveOut() + '```finding\ncategory: Bug\nlocation: a:1\nfailure_scenario: x\n```\n');
  fails(c.done(rv2.step_id), 'MISSING_EVIDENCE', /APPROVE must have no finding/);
  const rv3 = c.take(byKind('spawn', 'reviewer-code'));
  writeFileSync(rv3.output_path, '```finding\ncategory: Style\nlocation: a:1\nfailure_scenario: ugly\n```\n'.replace(/^/, 'VERDICT: FINDINGS\n'));
  fails(c.done(rv3.step_id), 'MISSING_EVIDENCE', /category must be one of Bug \| Spec miss \| Security \| Breakage, got Style[\s\S]*attempt 3 \(cap 3\): raised E1/);
  // 3-4: the third attempt in a row is the cap: Non-convergence parks the slice; retry buys one more.
  const capped = c.take(card('escalation'));
  assert.equal(capped.card.title, 'Non-convergence (reviewer-code on S1)');
  assert.equal(S().state, 'ESCALATED');
  ok(decide(w, 'sa', 'rule E1 retry use the charter categories', { cwd: wt }));
  assert.equal(S().state, 'IN_REVIEW');
  const rv4 = c.take(byKind('spawn', 'reviewer-code'));
  assert.equal(rv4.attempt, 4);
  assert.equal(ok(c.agent(rv4, findingsOut('The footer is missing on /about'), 'ag-rv4')).state, 'verified');
  assert.equal(last(w, id, 'step_verified').data.verdict, 'FINDINGS');
  assert.deepEqual(last(w, id, 'step_reported').data.output.findings, [{ category: 'Bug', location: 'footer.js:1', failure_scenario: 'The footer is missing on /about' }]);
  assert.equal(S().state, 'FINDINGS_QUEUED');
  // A takeover: sa's agent is gone, so round 2 is a spawn, with the findings in its brief.
  say(w, 'sb', `resume ${id}`);
  ok(run(w, ['resume', id, '--session', 'sb'], { cwd: wt }));
  const cb = conductor(w, 'sb');
  cb.cwd = wt;
  const r2 = { ...r, c: cb };
  const b3 = cb.take(byKind('spawn', 'builder'));
  assert.deepEqual([S().rounds, S().state], [2, 'BUILDING']);
  assert.match(readFileSync(b3.brief_path, 'utf8'), /reviewer-code returned FINDINGS[\s\S]*Bug at footer\.js:1: The footer is missing on \/about/);
  ok(builds(r2, b3, { 'footer.js': '2\n' }, 'ag-b3'));
  assert.deepEqual(cb.checks().map((x) => x.passed), [true]);
  const rv5 = cb.take(byKind('spawn', 'reviewer-code'));
  ok(cb.agent(rv5, findingsOut('Still missing on /about'), 'ag-rv5'));
  // The cap: Non-convergence, raised by the CLI, parks the slice.
  const nc = cb.take(card('escalation'));
  assert.deepEqual({ title: nc.card.title, commands: nc.card.commands }, {
    title: 'Non-convergence (S1)', commands: ['/factory rule E2 retry <note…>', '/factory rule E2 accept', '/factory abandon'],
  });
  assert.match(nc.card.reason, /S1 is not done after 2 builder rounds: reviewer-code still reports 1 finding/);
  assert.equal(S().state, 'ESCALATED');
  fails(decide(w, 'sb', 'rule E2 shrug', { cwd: wt }), 'ILLEGAL_TRANSITION', /retry <note…> or accept/);
  // retry: one more round, resuming sb's own builder, with the note.
  ok(decide(w, 'sb', 'rule E2 retry check every route', { cwd: wt }));
  const b4 = cb.take(byKind('resume', 'builder'));
  assert.deepEqual([b4.agent_id, S().rounds], ['ag-b3', 2]);
  assert.match(readFileSync(b4.brief_path, 'utf8'), /E2 retry: check every route/);
  ok(builds(r2, b4, { 'footer.js': '3\n' }, 'ag-b3'));
  assert.deepEqual(cb.checks().map((x) => x.passed), [true]);
  const rv6 = cb.take(byKind('spawn', 'reviewer-code'));
  ok(cb.agent(rv6, findingsOut('Still missing'), 'ag-rv6'));
  const nc2 = cb.take(card('escalation'));
  assert.equal(nc2.card.escalation, 'E3');
  // accept closes the slice as it is: BUILD completes and WRAP starts.
  const acc = ok(decide(w, 'sb', 'rule E3 accept', { cwd: wt }));
  assert.equal(S().state, 'CLOSED');
  assert.deepEqual(acc.verified, [nc2.step_id]);
  const wraps = cb.wrapChecks();
  assert.deepEqual(wraps.map((x) => x.name), ['contract.health', 'contract.test']);
  assert.equal(stateOf(w, id).phase, 'WRAP');
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, 'sb', 'abandon', { cwd: wt }));
});

test('a manifest change raises New dependency at close; accept closes; a failing WRAP check blocks the merge card; rework S1 from the card voids the close and the WRAP checks and resumes the builder with the note', (t) => {
  const w = world();
  const r = toBuild(w, 'sa', t, { ...NO_SERVER, test: 'test ! -f wrapfail && npm test --silent' });
  const { id, c, wt } = r;
  const pkg = readFileSync(join(wt, 'package.json'), 'utf8');
  const b1 = c.take(byKind('spawn', 'builder'));
  passingRound(r, b1, { 'footer.js': '1\n', 'package.json': pkg.replace('"private": true', '"private": true,\n  "dependencies": { "left-pad": "1.3.0" }') }, 'ag-b1');
  const nd = c.take(card('escalation'));
  assert.deepEqual({ title: nd.card.title, reason: nd.card.reason, commands: nd.card.commands }, {
    title: 'New dependency (S1)', reason: 'package.json', commands: ['/factory rule E1 accept', '/factory rule E1 retry <note…>', '/factory abandon'],
  });
  const deps = last(w, id, 'check_ran');
  assert.deepEqual([deps.data.check, deps.data.exit_code, deps.data.sha], ['git.deps', 1, headOf(wt)]);
  assert.equal(stateOf(w, id).slices.S1.state, 'ESCALATED');
  ok(decide(w, 'sa', 'rule E1 accept', { cwd: wt }));
  writeFileSync(join(wt, 'wrapfail'), 'x\n'); // untracked: the WRAP test fails
  const wraps = c.wrapChecks();
  assert.deepEqual(wraps.map((x) => [x.name, x.passed]), [['contract.health', true], ['contract.test', false]]);
  const closed = last(w, id, 'slice_closed');
  assert.equal(closed.data.slice, 'S1');
  const m1 = c.take(card('merge'));
  assert.deepEqual(m1.card.commands, ['/factory rework S1 <note…>', '/factory abandon']);
  assert.match(m1.card.reason, /contract\.test failed \(exit 1\)/);
  fails(decide(w, 'sa', 'merge', { cwd: wt }), 'ILLEGAL_TRANSITION', /offers no merge/);
  // rework S1: back to BUILD, the close and the WRAP checks voided, not a round.
  const wrapIds = commands(w, id).filter((e) => e.kind === 'check_ran' && ['contract.health', 'contract.test', 'git.baseline'].includes(e.data.check) && e.id > closed.id).map((e) => e.id);
  assert.equal(wrapIds.length, 3);
  const rw = ok(decide(w, 'sa', 'rework S1 drop the dependency', { cwd: wt }));
  assert.deepEqual([rw.phase, rw.verified], ['BUILD', [m1.step_id]]);
  const voids = last(w, id, 'rework_requested').data.voids;
  for (const v of [closed.id, ...wrapIds, ...wraps.map((x) => x.step_id)]) assert.ok(voids.includes(v), `${v} voided`);
  const s1 = stateOf(w, id);
  assert.deepEqual([s1.slices.S1.state, s1.slices.S1.rounds, s1.merge_approved], ['BUILDING', 0, false]);
  fails(decide(w, 'sa', 'rework S1 again', { cwd: wt }), 'ILLEGAL_TRANSITION', /rework S1 in BUILD: only at an open merge card/);
  const b2 = c.take(byKind('resume', 'builder'));
  assert.equal(b2.agent_id, 'ag-b1');
  assert.match(readFileSync(b2.brief_path, 'utf8'), /Notes from the human[\s\S]*drop the dependency/);
  rmSync(join(wt, 'wrapfail'));
  passingRound(r, b2, { 'package.json': pkg }, 'ag-b1');
  assert.deepEqual(c.wrapChecks().map((x) => [x.name, x.passed]), [['contract.health', true], ['contract.test', true]]);
  assert.equal(last(w, id, 'check_ran').data.check, 'contract.test');
  const deps2 = commands(w, id).filter((e) => e.kind === 'check_ran' && e.data.check === 'git.deps').at(-1);
  assert.equal(deps2.data.exit_code, 0, 'the manifest is back as it was');
  const m2 = c.take(card('merge'));
  assert.deepEqual(m2.card.commands, ['/factory merge', '/factory rework S1 <note…>', '/factory abandon']);
  assert.match(m2.card.reason, /S1 add a footer · reviewer-code APPROVE · 0 rounds/);
  assert.equal(m2.card.sha, headOf(wt));
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, 'sa', 'abandon', { cwd: wt }));
});

test('WRAP integrates a moved target cleanly; merge is refused on a changed main checkout, a detached HEAD or a moved target, then merges --no-ff; a failed worktree removal is reported and the run still completes', (t) => {
  const w = world();
  const r = toBuild(w, 'sa', t);
  const { id, c, wt } = r;
  const branch = branchOf(w.repo);
  const b1 = c.take(byKind('spawn', 'builder'));
  commitIn(w.repo, 'main.txt', 'on main\n', 'main moves'); // the target moves during BUILD
  passingRound(r, b1, { 'footer.js': '1\n' }, 'ag-b1');
  assert.deepEqual(c.wrapChecks().map((x) => x.passed), [true, true]);
  // The run branch now contains the target, merged by the CLI; the checks ran at that head.
  const target = headOf(w.repo);
  assert.equal(git(wt, 'merge-base', '--is-ancestor', target, 'HEAD'), '');
  assert.equal(git(wt, 'log', '-1', '--format=%s').trim(), `factory: integrate ${branch} into factory/${id}`);
  const m1 = c.take(card('merge'));
  assert.deepEqual([m1.card.sha, m1.card.target], [headOf(wt), target]);
  assert.match(m1.card.reason, /· 1 file changed, 1 insertion\(\+\) ·/, "the run's own change: main's commit is not counted");
  // Refusals: the prompt is consumed and the card stays open.
  writeFileSync(join(w.repo, 'stray.txt'), 'x\n');
  const a = decide(w, 'sa', 'merge', { cwd: wt });
  fails(a, 'MISSING_EVIDENCE', /differs from its baseline/);
  assert.equal(consumed(w, a.pid), 'missing_evidence');
  rmSync(join(w.repo, 'stray.txt'));
  git(w.repo, 'checkout', '-q', '--detach');
  fails(decide(w, 'sa', 'merge', { cwd: wt }), 'ILLEGAL_TRANSITION', /detached HEAD/);
  git(w.repo, 'checkout', '-q', branch);
  commitIn(w.repo, 'main2.txt', 'later\n', 'main moves again');
  fails(decide(w, 'sa', 'merge', { cwd: wt }), 'MISSING_EVIDENCE', /target moved/);
  assert.equal(stateOf(w, id).steps[m1.step_id].state, 'claimed', 'the card stays');
  // next: the stale card is closed, the new target integrated, the checks re-run, a fresh card.
  assert.deepEqual(c.wrapChecks().map((x) => x.passed), [true, true]);
  assert.equal(stateOf(w, id).steps[m1.step_id].state, 'verified');
  const m2 = c.take(card('merge'));
  assert.deepEqual([m2.card.sha, m2.card.target], [headOf(wt), headOf(w.repo)]);
  const runHead = headOf(wt);
  const md = ok(decide(w, 'sa', 'merge', { cwd: wt }));
  assert.equal(md.phase, 'MERGED');
  // The main checkout's branch holds the run branch, through a merge commit.
  assert.equal(git(w.repo, 'merge-base', '--is-ancestor', runHead, 'HEAD'), '');
  assert.equal(git(w.repo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ').length, 3, 'a --no-ff merge commit');
  assert.equal(readFileSync(join(w.repo, 'footer.js'), 'utf8'), '1\n');
  const ma = last(w, id, 'merge_approved');
  assert.deepEqual([ma.data.sha, ma.data.target, ma.data.pins.length], [runHead, branch, 2]);
  const gm = last(w, id, 'check_ran');
  assert.deepEqual([gm.data.check, gm.data.exit_code], ['git.merged', 0]);
  assert.deepEqual(last(w, id, 'merged').data, { sha: headOf(w.repo), target: branch });
  // exit_worktree: from inside it is refused and reissued; from outside next verifies it.
  writeFileSync(join(wt, 'leftover.txt'), 'untracked\n'); // git worktree remove (no --force) refuses
  const ex = c.take(byKind('exit_worktree'));
  assert.equal(ex.path, wt);
  fails(c.done(ex.step_id), 'MISSING_EVIDENCE', /still inside the worktree/);
  c.cwd = w.repo; // ExitWorktree
  const fin = c.next();
  assert.equal(fin.done, true);
  assert.equal(fin.worktree_removed, false);
  assert.match(fin.worktree_error, /untracked|modified/);
  const s = stateOf(w, id);
  assert.equal(s.phase, 'COMPLETED');
  assert.equal(existsSync(join(w.home, 'ports', String(r.port))), false, 'the port is released');
  assert.equal(existsSync(join(runDir(w, id), 'devserver.pid')), false, 'the dev server is stopped');
  assert.ok(existsSync(join(w.home, 'recordings', id, 'manifest.json')));
  assert.equal(fin.recording, join(w.home, 'recordings', id));
  fails(run(w, ['record', id, '--session', 'sa']), 'CLAIM_TAKEN');
  assert.deepEqual(s.rejected, []);
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
});

test('WRAP: a conflicting target blocks the card with the files; the human resolves on the run branch and the next factory next re-runs the checks and offers the merge', (t) => {
  const w = world();
  const r = toBuild(w, 'sa', t);
  const { id, c, wt } = r;
  const branch = branchOf(w.repo);
  const b1 = c.take(byKind('spawn', 'builder'));
  commitIn(w.repo, 'footer.js', 'main footer\n', 'main adds a footer too');
  passingRound(r, b1, { 'footer.js': 'run footer\n' }, 'ag-b1');
  const head1 = headOf(wt);
  const m1 = c.take(card('merge'));
  assert.deepEqual(m1.card.commands, ['/factory rework S1 <note…>', '/factory abandon']);
  assert.match(m1.card.reason, new RegExp(`conflicts with ${branch}: footer\\.js`));
  assert.equal(headOf(wt), head1, 'the failed integration was aborted');
  assert.equal(git(wt, 'status', '--porcelain=v2', '--untracked-files=no').trim(), '');
  assert.equal(commands(w, id).some((e) => e.kind === 'step_issued' && e.data.stage === 'WRAP' && e.data.kind === 'run_check'), false, 'no checks before the conflict is resolved');
  assert.deepEqual(c.next().steps, [], 'the same card is not raised twice');
  fails(decide(w, 'sa', 'merge', { cwd: wt }), 'ILLEGAL_TRANSITION', /offers no merge/);
  // The human resolves it on the run branch.
  const res = spawnSync('git', ['merge', branch], { cwd: wt });
  assert.notEqual(res.status, 0);
  writeFileSync(join(wt, 'footer.js'), 'run footer\nmain footer\n');
  git(wt, 'add', 'footer.js');
  // Mid-resolution, next leaves the human's merge alone and says so on a fresh card.
  const mp = c.take(card('merge'));
  assert.match(mp.card.reason, /a merge is in progress in the worktree/);
  assert.deepEqual(mp.card.commands, ['/factory rework S1 <note…>', '/factory abandon']);
  assert.ok(git(wt, 'rev-parse', '-q', '--verify', 'MERGE_HEAD').trim(), 'MERGE_HEAD survives');
  assert.equal(git(wt, 'diff', '--cached', '--name-only').trim(), 'footer.js', 'the staged resolution survives');
  assert.equal(readFileSync(join(wt, 'footer.js'), 'utf8'), 'run footer\nmain footer\n');
  git(wt, 'commit', '-q', '--no-edit');
  assert.deepEqual(c.wrapChecks().map((x) => [x.name, x.passed]), [['contract.health', true], ['contract.test', true]]);
  assert.equal(stateOf(w, id).steps[m1.step_id].state, 'verified', 'the stale card is closed');
  const m2 = c.take(card('merge'));
  assert.deepEqual([m2.card.commands[0], m2.card.sha], ['/factory merge', headOf(wt)]);
  assert.equal(ok(decide(w, 'sa', 'merge', { cwd: wt })).phase, 'MERGED');
  assert.equal(readFileSync(join(w.repo, 'footer.js'), 'utf8'), 'run footer\nmain footer\n');
  c.cwd = w.repo;
  const fin = c.next();
  assert.deepEqual([fin.done, fin.worktree_removed], [true, true]);
  assert.equal(existsSync(wt), false);
  assert.deepEqual(stateOf(w, id).rejected, []);
});

test('acceptance: builder → test → FINDINGS → builder resume → test → APPROVE → close → WRAP checks → /factory merge → exit_worktree, through bin/factory, ends COMPLETED with the change merged, the worktree gone, the port released and a redacted recording', SERVER, async (t) => {
  const w = world();
  const s = 'sa';
  const r = toBuild(w, s, t, {}); // the real contract: npm start, npm test, npm run health
  const { id, c, wt } = r;
  const branch = branchOf(w.repo);
  // Round 0: the builder writes the footer (and quotes the secret in its notes); test; FINDINGS.
  const b1 = c.take(byKind('spawn', 'builder'));
  ok(builds(r, b1, { 'footer.js': "module.exports = () => '<footer>';\n" }, 'ag-b1', builderOut('Added the footer', `Used API_TOKEN=${SECRET} from .env\n`)));
  const sha1 = last(w, id, 'step_reported').data.sha;
  assert.equal(sha1, headOf(wt));
  assert.deepEqual(c.checks().map((x) => [x.name, x.passed]), [['contract.test', true]]);
  const rv1 = c.take(byKind('spawn', 'reviewer-code'));
  assert.equal(ok(c.agent(rv1, findingsOut('The footer is not rendered by server.js, so / shows no footer (AC-2)'), 'ag-rv1')).state, 'verified');
  // Round 1: the same builder, resumed with the findings.
  const b2 = c.take(byKind('resume', 'builder'));
  assert.equal(b2.agent_id, 'ag-b1');
  assert.match(readFileSync(b2.brief_path, 'utf8'), /so \/ shows no footer \(AC-2\)/);
  const server = "const footer = require('./footer.js');\nrequire('node:http').createServer((q, r) => r.end(q.url === '/health' ? 'ok' : `<main></main>${footer()}`)).listen(Number(process.env.PORT), '127.0.0.1');\n";
  ok(builds(r, b2, { 'server.js': server }, 'ag-b1', builderOut('Rendered the footer')));
  assert.deepEqual(c.checks().map((x) => [x.name, x.passed]), [['contract.test', true]]);
  const rv2 = c.take(byKind('spawn', 'reviewer-code'));
  ok(c.agent(rv2, approveOut(), 'ag-rv2'));
  // Close → WRAP: health (on a restarted server) and test at the branch head, the baseline, the card.
  const pidOf = (): number => JSON.parse(readFileSync(join(runDir(w, id), 'devserver.pid'), 'utf8')).pid;
  const scaffoldPid = pidOf();
  assert.deepEqual(c.wrapChecks().map((x) => [x.name, x.passed]), [['contract.health', true], ['contract.test', true]]);
  assert.notEqual(pidOf(), scaffoldPid, 'WRAP health judged a server started from the run branch head');
  const st = stateOf(w, id);
  assert.deepEqual([st.phase, st.slices.S1.state, st.slices.S1.rounds], ['WRAP', 'CLOSED', 1]);
  const m = c.take(card('merge'));
  assert.deepEqual(m.card.commands, ['/factory merge', '/factory rework S1 <note…>', '/factory abandon']);
  assert.match(m.card.reason, /S1 add a footer · reviewer-code APPROVE · 1 round · [0-9a-f]{12} into /);
  assert.match(m.card.reason, /2 files changed[\s\S]*contract\.test passed/);
  const runHead = headOf(wt);
  assert.equal(ok(decide(w, s, 'merge', { cwd: wt })).phase, 'MERGED');
  assert.equal(git(w.repo, 'merge-base', '--is-ancestor', runHead, branch), '');
  // exit_worktree, then housekeeping from outside.
  const ex = c.take(byKind('exit_worktree'));
  c.cwd = w.repo; // ExitWorktree(keep)
  assert.equal(ok(c.done(ex.step_id)).state, 'verified');
  appendFileSync(join(w.projects, '-repo', `${s}.jsonl`), JSON.stringify({ type: 'assistant', sessionId: s, message: { content: `the token ${SECRET}` } }) + '\n');
  const fin = c.next();
  assert.deepEqual([fin.done, fin.worktree_removed, fin.devserver_stopped], [true, true, true]);
  const s2 = stateOf(w, id);
  assert.equal(s2.phase, 'COMPLETED');
  assert.ok(git(w.repo, 'log', '--format=%s', branch).includes(`factory: merge factory/${id}`));
  assert.equal(readFileSync(join(w.repo, 'footer.js'), 'utf8'), "module.exports = () => '<footer>';\n", "the main checkout's branch holds the builder's change");
  assert.equal(existsSync(wt), false, 'the worktree is gone');
  assert.ok(!git(w.repo, 'worktree', 'list').includes(wt));
  assert.equal(existsSync(join(w.home, 'ports', String(r.port))), false, 'the port is released');
  // The recording: manifest, the run tree without redact.json/lock/devserver files, transcripts; no SECRET.
  const rec = join(w.home, 'recordings', id);
  const manifest = JSON.parse(readFileSync(join(rec, 'manifest.json'), 'utf8'));
  assert.deepEqual([manifest.v, manifest.name, manifest.plugin_version, manifest.runs.map((x: any) => x.run_id)], [1, id, '0.1.0', [id]]);
  const files = (readdirSync(rec, { recursive: true }) as string[]).filter((f) => statSync(join(rec, f)).isFile());
  assert.ok(files.some((f) => f.endsWith('commands.jsonl')) && files.some((f) => f.includes('/facts/')) && files.some((f) => f.endsWith('out.md')), files.join('\n'));
  assert.ok(files.includes(join('transcripts', `${s}.jsonl`)), files.join('\n'));
  for (const bad of ['redact.json', 'devserver.pid', 'devserver.log', 'lock']) assert.ok(!files.some((f) => f.split('/').includes(bad)), bad);
  for (const f of files) assert.ok(!readFileSync(join(rec, f), 'utf8').includes(SECRET), `${f} leaks the secret`);
  const outs = files.filter((f) => f.endsWith('out.md')).map((f) => readFileSync(join(rec, f), 'utf8'));
  assert.ok(outs.some((x) => x.includes('API_TOKEN=[REDACTED]')), 'the builder notes are redacted in the recording');
  assert.match(readFileSync(join(rec, 'transcripts', `${s}.jsonl`), 'utf8'), /token \[REDACTED\]/);
  const replay = fold(readFileSync(join(rec, 'runs', s2.repo_hash!, id, 'commands.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
  assert.equal(replay.phase, 'COMPLETED', 'a replay of the recording ends COMPLETED');
  // 4-1: CAPTURE_RECORDING=1 refreshes the committed fixture recording captured from this run (then
  // refresh its timeline snapshot with UPDATE_SNAPSHOTS=1 node --test test/timeline.test.ts).
  if (process.env.CAPTURE_RECORDING) {
    const dest = join(import.meta.dirname, 'fixtures', 'recordings', 'pipeline-acceptance');
    rmSync(dest, { recursive: true, force: true });
    cpSync(rec, dest, { recursive: true });
  }
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(s2.rejected, []);

  // 2-1 acceptance: the home served by the dashboard shows every stage and slice card done, every
  // claim chip verified, and each human decision once as a seal: intake, gate 1, gate 2, merge.
  const board = await serveBoard(w);
  const [lane] = board.projection.runs;
  assert.deepEqual([board.projection.runs.length, lane.run_id, lane.phase, lane.terminal, lane.skipped], [1, id, 'COMPLETED', true, 0]);
  assert.deepEqual(lane.cards.map((c: any) => [c.id, c.column]), [
    ['stage:INTAKE', 'done'], ['stage:RECON', 'done'], ['stage:SCAFFOLD', 'done'], ['stage:SPEC', 'done'], ['stage:SLICE_PLAN', 'done'], ['stage:WRAP', 'done'], ['slice:S1', 'done'],
  ]);
  const claims = lane.cards.flatMap((c: any) => c.claims);
  assert.ok(claims.length >= 10, `${claims.length} claims`);
  assert.deepEqual(claims.filter((c: any) => c.state !== 'verified' || c.superseded), [], 'every claim chip is verified');
  assert.ok(claims.every((c: any) => c.evidence.length > 0), 'every verified claim names its evidence');
  const kind = (d: string): string => lane.decisions.find((x: any) => x.id === d).kind;
  assert.deepEqual(lane.cards.flatMap((c: any) => c.seals.map((d: string) => [c.id, kind(d)])), [
    ['stage:INTAKE', 'intake_confirmed'], ['stage:SPEC', 'gate_1_passed'], ['stage:SLICE_PLAN', 'gate_2_passed'], ['stage:WRAP', 'merge_approved'],
  ]);
  assert.deepEqual(lane.decisions.map((d: any) => d.prompt_text), ['/factory approve intake', '/factory approve gate1', '/factory approve gate2', '/factory merge']);
  assert.ok(!JSON.stringify(board).includes(SECRET), 'the board never shows a redacted value');
  assert.equal(lane.live.signal_lost, false);
});

test('merge: WRAP health restarts the dev server; a card blocked by a changed main checkout refreshes once it is restored; a changed pinned output and a failed git merge are refused, the card still offers the merge, and a retry merges; record --runs', (t) => {
  const w = world();
  const r = toBuild(w, 'sa', t);
  const { id, c, wt } = r;
  const b1 = c.take(byKind('spawn', 'builder'));
  const { rv } = passingRound(r, b1, { 'footer.js': '1\n' }, 'ag-b1');
  const pidOf = (): number => JSON.parse(readFileSync(join(runDir(w, id), 'devserver.pid'), 'utf8')).pid;
  const scaffoldPid = pidOf();
  assert.deepEqual(c.wrapChecks().map((x) => [x.name, x.passed]), [['contract.health', true], ['contract.test', true]]);
  assert.notEqual(pidOf(), scaffoldPid, 'WRAP health restarted the dev server');
  // A changed main checkout blocks the card; restoring it brings a fresh card that offers the merge.
  writeFileSync(join(w.repo, 'stray.txt'), 'x\n');
  const m1 = c.take(card('merge'));
  assert.deepEqual(m1.card.commands, ['/factory rework S1 <note…>', '/factory abandon']);
  assert.match(m1.card.reason, /the main checkout differs from its baseline/);
  assert.deepEqual(c.next().steps, [], 'still dirty: the card stays');
  rmSync(join(w.repo, 'stray.txt'));
  const m2 = c.take(card('merge'));
  assert.equal(stateOf(w, id).steps[m1.step_id].state, 'verified');
  assert.deepEqual(m2.card.commands, ['/factory merge', '/factory rework S1 <note…>', '/factory abandon']);
  // A pinned output changed since it was verified: refused, the card stays.
  const review = readFileSync(rv.output_path, 'utf8');
  writeFileSync(rv.output_path, review + 'edited later\n');
  fails(decide(w, 'sa', 'merge', { cwd: wt }), 'MISSING_EVIDENCE', /changed since it was verified/);
  assert.equal(stateOf(w, id).steps[m2.step_id].state, 'claimed');
  writeFileSync(rv.output_path, review);
  // The final git merge fails (the main checkout's pre-merge-commit hook): aborted, recorded, not merged.
  const hook = join(w.repo, '.git', 'hooks', 'pre-merge-commit');
  writeFileSync(hook, '#!/bin/sh\necho no merges today >&2\nexit 1\n', { mode: 0o755 });
  const status = git(w.repo, 'status', '--porcelain=v2');
  const before = headOf(w.repo);
  const f = decide(w, 'sa', 'merge', { cwd: wt });
  fails(f, 'CHECK_FAILED', /git merge into .* failed and was aborted/);
  assert.equal(consumed(w, f.pid), 'decided');
  const gm = last(w, id, 'check_ran');
  assert.deepEqual([gm.data.check, gm.data.exit_code], ['git.merged', 1]);
  assert.equal(commands(w, id).some((e) => e.kind === 'merged'), false);
  assert.equal(stateOf(w, id).phase, 'WRAP');
  assert.deepEqual([headOf(w.repo), git(w.repo, 'status', '--porcelain=v2')], [before, status], 'the main checkout is as it was');
  const m3 = c.take(card('merge'));
  assert.deepEqual(m3.card.commands, ['/factory merge', '/factory rework S1 <note…>', '/factory abandon']);
  assert.match(m3.card.reason, /the last git merge failed \(exit 1\) and was aborted/);
  rmSync(hook);
  const approved = headOf(wt);
  assert.equal(ok(decide(w, 'sa', 'merge', { cwd: wt })).phase, 'MERGED');
  assert.equal(git(w.repo, 'rev-parse', 'HEAD^2').trim(), approved, 'the approved commit was merged');
  const ex = c.take(byKind('exit_worktree'));
  c.cwd = w.repo;
  ok(c.done(ex.step_id));
  assert.equal(c.next().done, true);
  assert.equal(stateOf(w, id).phase, 'COMPLETED');
  // factory record through the CLI: --runs names the run; an empty list is refused.
  const rec = ok(run(w, ['record', 'again', '--runs', id, '--session', 'sa']));
  assert.deepEqual(rec.runs.map((x: any) => x.run_id), [id]);
  assert.deepEqual(JSON.parse(readFileSync(join(w.home, 'recordings', 'again', 'manifest.json'), 'utf8')).runs.map((x: any) => x.run_id), [id]);
  fails(run(w, ['record', 'none', '--runs', ',', '--session', 'sa']), 'BAD_ARGS', /at least one run id/);
  assert.deepEqual(stateOf(w, id).rejected, []);
});

// --- 3-1: the budget clock and the live cut gate -------------------------------------------------

test('acceptance (3-1): intake started 2 h ago with limit_min 100; at BUILD with S1–S3 next raises the cut card before slice_started S1; /factory cut S2,S3 cuts them, S1 builds, no second cut card', (t) => {
  const w = world();
  const s = 'sa';
  const started2h = new Date(Date.now() - 2 * 3600_000).toISOString();
  // Gate 2 with three slices from the slicer (3-3).
  const slices = [{ id: 'S1', title: 'Footer markup', acs: ['AC-1'] }, { id: 'S2', title: 'Footer styles', acs: ['AC-2'] }, { id: 'S3', title: 'Footer links', acs: ['AC-2'] }];
  const r = toGate2(w, s, t, NO_SERVER, { limit_min: 100, started: started2h }, slices);
  const { id, c, wt } = r;
  const ic = last(w, id, 'intake_confirmed');
  assert.deepEqual(ic.data.intake, { limit_min: 100, slice_timebox_min: 30, ui_free: true, reviewer_overrides: { add: [], remove: [] }, started: started2h });
  assert.equal(ic.data.clock_start, started2h, 'the exercise started before the run');
  assert.equal(ok(decide(w, s, 'approve gate2', { cwd: wt })).phase, 'BUILD');

  // The cut point (2:00 ago + 1:40 − 0:40) passed before BUILD: the card comes before S1 starts.
  const n = c.next();
  assert.deepEqual(n.steps.map((x: any) => [x.kind, x.card?.type]), [['ask_human', 'cut']], 'only the cut card: no slice started');
  const cut = n.steps[0];
  assert.deepEqual({ title: cut.card.title, commands: cut.card.commands }, {
    title: 'Cut point reached — 3 slices unbuilt. Cut S1, S2, S3?', commands: ['/factory cut S1,S2,S3', '/factory keep'],
  });
  const raised = last(w, id, 'ask_raised');
  assert.deepEqual(raised.data.card, cut.card);
  assert.equal(commands(w, id).some((e) => e.kind === 'slice_started'), false);
  c.claim(cut.step_id);
  assert.deepEqual(c.next().steps, [], 'no slice starts while the cut card is open');
  // The board: the clock, its deadlines, every Backlog slice AT RISK, and the cut card once in Needs You.
  const cmds = commands(w, id);
  const lane = projectRun({ state: fold(cmds), commands: cmds, facts: [], skipped: [] }, { repo_hash: 'h', run_id: id });
  assert.deepEqual(lane.budget, { clock_start: started2h, limit_min: 100, cut_at: new Date(Date.parse(started2h) + 60 * 60_000).toISOString(), ends_at: new Date(Date.parse(started2h) + 100 * 60_000).toISOString(), stopped_at: null });
  assert.deepEqual([lane.deadlines.cut_at, lane.deadlines.ends_at], [lane.budget!.cut_at, lane.budget!.ends_at]);
  assert.deepEqual(lane.cards.filter((x) => x.kind === 'slice').map((x) => [x.id, x.at_risk]), [['slice:S1', true], ['slice:S2', true], ['slice:S3', true]]);
  assert.deepEqual(lane.needs_you.map((x) => x.card.type), ['cut']);

  // Refusals leave the card open: an unknown slice, then the cut.
  fails(decide(w, s, 'cut S4', { cwd: wt }), 'ILLEGAL_TRANSITION', /no slice S4/);
  const d = ok(decide(w, s, 'cut S2,S3', { cwd: wt }));
  assert.deepEqual(d.verified, [cut.step_id]);
  const st = stateOf(w, id);
  assert.deepEqual(st.slice_order.map((x) => st.slices[x].state), ['BACKLOG', 'CUT', 'CUT']);
  assert.deepEqual([st.cut_decided, Object.values(st.asks).filter((a) => a.open).length], [true, 0]);
  // S1 builds, closes, and BUILD completes past the cut slices; the cut is never raised again.
  const b1 = c.take(byKind('spawn', 'builder'));
  assert.equal(b1.slice, 'S1');
  assert.equal(last(w, id, 'slice_started').data.slice, 'S1');
  passingRound(r, b1, { 'footer.js': '1\n' }, 'ag-b1');
  assert.deepEqual(c.wrapChecks().map((x) => x.passed), [true, true]);
  assert.equal(stateOf(w, id).phase, 'WRAP');
  assert.equal(commands(w, id).filter((e) => e.kind === 'ask_raised' && e.data.card.type === 'cut').length, 1, 'one cut card');
  fails(decide(w, s, 'keep', { cwd: wt }), 'ILLEGAL_TRANSITION', /cut_decided in WRAP/);
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

test('keep: the cut card is answered with nothing cut, the Backlog slices lose AT RISK, and the cut is never raised again', (t) => {
  const w = world();
  const s = 'sa';
  // A limit under the cut lead: the cut point is behind the run start.
  const r = toGate2(w, s, t, NO_SERVER, { limit_min: 30 }, [{ id: 'S1', title: 'One', acs: ['AC-1', 'AC-2'] }, { id: 'S2', title: 'Two', acs: ['AC-2'] }]);
  const { id, c, wt } = r;
  ok(decide(w, s, 'approve gate2', { cwd: wt }));
  fails(decide(w, s, 'keep', { cwd: wt }), 'ILLEGAL_TRANSITION', /no open cut card/);
  const cut = c.take(card('cut'));
  assert.equal(cut.card.title, 'Cut point reached — 2 slices unbuilt. Cut S1, S2?');
  assert.deepEqual(ok(decide(w, s, 'keep', { cwd: wt })).verified, [cut.step_id]);
  const b1 = c.take(byKind('spawn', 'builder'));
  assert.equal(b1.slice, 'S1');
  const cmds = commands(w, id);
  const lane = projectRun({ state: fold(cmds), commands: cmds, facts: [], skipped: [] }, { repo_hash: 'h', run_id: id });
  assert.deepEqual(lane.cards.filter((x) => x.kind === 'slice').map((x) => [x.id, x.state, x.at_risk ?? false]), [['slice:S1', 'BUILDING', false], ['slice:S2', 'BACKLOG', false]]);
  assert.deepEqual(stateOf(w, id).slices.S2.state, 'BACKLOG');
  assert.equal(cmds.filter((e) => e.kind === 'ask_raised').length, 1);
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

// --- 3-2: the designer in parallel with the spec ------------------------------------------------

// start → an intake that is not UI-free → RECON (`recon`: its context) → SCAFFOLD's checks passed,
// with no dev server bound. The next `next` verifies the scaffolder and issues SPEC_DESIGN's steps.
function toSpecDesign(w: World, s: string, t: TestContext, recon = reconOut(), o: Record<string, unknown> = {}) {
  const r = started(w, s, undefined, { ui_free: false });
  t.after(() => { run(w, ['devserver', 'down', '--session', s]); });
  const rc = r.c.take(byKind('spawn', 'recon'));
  assert.equal(ok(r.c.agent(rc, recon, 'ag-recon')).state, 'verified');
  const enter = r.c.take(byKind('enter_worktree'));
  r.c.cwd = enter.path;
  ok(r.c.done(enter.step_id));
  const port = portOf(w, r.id);
  const sc = r.c.take(byKind('spawn', 'scaffolder'));
  ok(r.c.agent(sc, scaffoldOut(contract(port, { ...NO_SERVER, ...o })), 'ag-scaffold'));
  assert.deepEqual(r.c.checks().map((x) => x.passed), [true, true]);
  return { ...r, wt: enter.path as string };
}
const inventRecon = (): string => reconOut().replace('origin: brownfield', 'origin: greenfield');

test('acceptance (3-2): brownfield with a UI surface: one next issues the spec-writer and the designer; gate 1 waits for both, reads Spec + Design, and approve gate1 pins both', (t) => {
  const w = world();
  const s = 'sa';
  const { id, c, wt } = toSpecDesign(w, s, t, reconOut().replace('ui_surface: true\n', 'ui_surface: true\nui_reference: "src/components"\n'));
  const n = c.next();
  assert.deepEqual(n.steps.map((x: any) => [x.kind, x.agent, x.stage, x.attempt]), [
    ['spawn', 'd2t-factory:spec-writer', 'SPEC', 1], ['spawn', 'd2t-factory:designer', 'DESIGN', 1],
  ]);
  const [sw, ds] = n.steps;
  c.claim(sw.step_id);
  c.claim(ds.step_id);
  const brief = readFileSync(ds.brief_path, 'utf8');
  const context = stateOf(w, id).recon!.path;
  assert.ok(brief.includes('designer mode: inherit') && brief.includes('- ui_reference: src/components\n') && brief.includes(context) && brief.includes(wt) && brief.includes(ds.output_path), brief);
  assert.ok(!brief.includes('run contract'), 'the designer reads no run contract');

  // The spec first: linted, but gate 1 waits for the design.
  assert.equal(ok(c.agent(sw, specOut('Footer'), 'ag-spec')).state, 'verified');
  assert.deepEqual(c.checks().map((x) => [x.name, x.passed]), [['spec.lint', true]]);
  const waiting = c.next();
  assert.deepEqual([waiting.steps, waiting.in_flight], [[], [ds.step_id]]);
  fails(decide(w, s, 'approve gate1', { cwd: wt }), 'ILLEGAL_TRANSITION', /no open gate_1 card/);

  // The design: reported and verified, then the one gate card.
  const text = designOut({ assumptions: ['The footer reuses the header colors'] });
  assert.equal(ok(c.agent(ds, text, 'ag-design')).state, 'verified');
  const rep = last(w, id, 'step_reported');
  assert.deepEqual([rep.data.step_id, rep.data.output.front.mode, rep.data.output.question], [ds.step_id, 'inherit', undefined]);
  const g1 = c.take(card('gate_1'));
  assert.equal(g1.stage, 'SPEC');
  assert.equal(g1.card.title, 'Gate 1 — Spec + Design ready');
  assert.equal(g1.card.reason, `${sw.output_path} · ${ds.output_path} (inherit) · 2 assumptions to check`);
  assert.deepEqual(g1.card.commands, ['/factory approve gate1', '/factory rework gate1 <note…>']);

  const a = ok(decide(w, s, 'approve gate1', { cwd: wt }));
  assert.deepEqual({ phase: a.phase, verified: a.verified }, { phase: 'SLICE_PLAN', verified: [g1.step_id] });
  const passed = last(w, id, 'gate_1_passed');
  assert.deepEqual(passed.data.pins, [{ path: sw.output_path, sha256: sha(specOut('Footer')) }, { path: ds.output_path, sha256: sha(text) }]);
  const lint = commands(w, id).filter((e) => e.kind === 'check_ran' && e.data.check === 'spec.lint').at(-1);
  assert.deepEqual(passed.data.evidence, [lint.id, sw.step_id, ds.step_id]);
  // The board: SPEC and DESIGN both sealed by gate 1.
  const cmds = commands(w, id);
  const lane = projectRun({ state: fold(cmds), commands: cmds, facts: [], skipped: [] }, { repo_hash: 'h', run_id: id });
  assert.deepEqual(lane.cards.filter((x) => x.id === 'stage:SPEC' || x.id === 'stage:DESIGN').map((x) => [x.id, x.seals]), [['stage:SPEC', [passed.id]], ['stage:DESIGN', [passed.id]]]);
  for (const e of cmds) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(stateOf(w, id).rejected, []);
  fails(decide(w, s, 'choose a', { cwd: wt }), 'ILLEGAL_TRANSITION', /design_choice_made in SLICE_PLAN/);
  // The builder reads the approved design next to the approved spec.
  c.plan();
  c.take(card('gate_2'));
  ok(decide(w, s, 'approve gate2', { cwd: wt }));
  const b1 = c.take(byKind('spawn', 'builder'));
  const bb = readFileSync(b1.brief_path, 'utf8');
  assert.ok(bb.includes(`the approved spec (pinned at gate 1): ${sw.output_path}`) && bb.includes(`the approved design (pinned at gate 1): ${ds.output_path}`), bb);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

test('acceptance (3-2): invent mode asks one question; /factory choose b (default a) voids the design, a second designer gets option b and the previous design, and a question in its output is rejected', (t) => {
  const w = world();
  const s = 'sa';
  const { id, c, wt } = toSpecDesign(w, s, t, inventRecon());
  const n = c.next();
  const [sw, ds] = n.steps;
  c.claim(sw.step_id);
  c.claim(ds.step_id);
  assert.match(readFileSync(ds.brief_path, 'utf8'), /designer mode: invent/);
  ok(c.agent(sw, specOut('Footer'), 'ag-spec'));
  assert.deepEqual(c.checks().map((x) => x.passed), [true]);
  fails(decide(w, s, 'choose a', { cwd: wt }), 'ILLEGAL_TRANSITION', /no open design_choice card/);
  // An inherit design in an invent context is rejected first.
  fails(c.agent(ds, designOut({ question: questionBlock() }), 'ag-d0'), 'MISSING_EVIDENCE', /mode must be invent/);
  const ds1 = c.take(byKind('spawn', 'designer'));
  assert.equal(ds1.attempt, 2);
  const first = designOut({ mode: 'invent', assumptions: ['system font'], question: questionBlock() });
  assert.equal(ok(c.agent(ds1, first, 'ag-d1')).state, 'verified');

  // The question card (stage DESIGN), not gate 1.
  const q = c.next();
  assert.deepEqual(q.steps.map((x: any) => [x.kind, x.stage, x.card?.type]), [['ask_human', 'DESIGN', 'design_choice']]);
  assert.deepEqual([q.steps[0].card.title, q.steps[0].card.commands], ['Design question — Light or dark footer?', ['/factory choose a', '/factory choose b']]);
  c.claim(q.steps[0].step_id);
  const cmds0 = commands(w, id);
  const lane = projectRun({ state: fold(cmds0), commands: cmds0, facts: [], skipped: [] }, { repo_hash: 'h', run_id: id });
  assert.deepEqual(lane.needs_you.map((x) => x.card.type), ['design_choice']);
  assert.equal(lane.cards.find((x) => x.id === 'stage:DESIGN')!.column, 'needs_you');

  // choose b: the card is verified, the designer step and its step_verified are voided.
  const ch = ok(decide(w, s, 'choose b', { cwd: wt }));
  assert.deepEqual([ch.decision, ch.phase, ch.verified], ['design_choice_made', 'SPEC_DESIGN', [q.steps[0].step_id]]);
  const made = last(w, id, 'design_choice_made');
  const dv = commands(w, id).find((e) => e.kind === 'step_verified' && e.data.step_id === ds1.step_id);
  assert.deepEqual([made.data.choice, made.data.voids], ['b', [ds1.step_id, dv.id]]);
  fails(decide(w, s, 'choose a', { cwd: wt }), 'ILLEGAL_TRANSITION', /no open design_choice card/);

  // A second designer: option b, the previous design as input, ask no question.
  const ds2 = c.take(byKind('spawn', 'designer'));
  assert.equal(ds2.attempt, 3);
  const brief = readFileSync(ds2.brief_path, 'utf8');
  assert.ok(brief.includes('option b — Dark') && brief.includes('ask no question') && brief.includes(ds1.output_path), brief);
  fails(c.agent(ds2, designOut({ mode: 'invent', question: questionBlock('Again?') }), 'ag-d2'), 'MISSING_EVIDENCE', /already answered: ask no question/);
  const ds3 = c.take(byKind('spawn', 'designer'));
  assert.match(readFileSync(ds3.brief_path, 'utf8'), /Your previous output was rejected[\s\S]*ask no question/);
  const dark = designOut({ mode: 'invent', front: { colors: { surface: '#0d1117', text: '#e6edf3' } } });
  assert.equal(ok(c.agent(ds3, dark, 'ag-d3')).state, 'verified');
  const g1 = c.take(card('gate_1'));
  assert.equal(g1.card.reason, `${sw.output_path} · ${ds3.output_path} (invent) · 1 assumption to check`);
  ok(decide(w, s, 'approve gate1', { cwd: wt }));
  assert.deepEqual(last(w, id, 'gate_1_passed').data.pins.map((p: any) => p.path), [sw.output_path, ds3.output_path]);
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

test('invent mode, /factory choose <default>: the card is verified, nothing is voided, the design stands and gate 1 follows', (t) => {
  const w = world();
  const s = 'sa';
  const { id, c, wt } = toSpecDesign(w, s, t, inventRecon());
  const [sw, ds] = c.next().steps;
  c.claim(sw.step_id);
  c.claim(ds.step_id);
  const text = designOut({ mode: 'invent', question: questionBlock('Rounded corners?', 'Yes', 'No', 'b') });
  ok(c.agent(ds, text, 'ag-d'));
  ok(c.agent(sw, specOut('Footer'), 'ag-spec'));
  assert.deepEqual(c.checks().map((x) => x.passed), [true]);
  const q = c.take(card('design_choice'));
  ok(decide(w, s, 'choose b', { cwd: wt }));
  assert.deepEqual(last(w, id, 'design_choice_made').data.voids, undefined);
  const n = c.next();
  assert.deepEqual(n.steps.map((x: any) => x.card?.type), ['gate_1'], 'no second designer');
  assert.equal(stateOf(w, id).steps[q.step_id].state, 'verified');
  c.claim(n.steps[0].step_id);
  ok(decide(w, s, 'approve gate1', { cwd: wt }));
  assert.deepEqual(last(w, id, 'gate_1_passed').data.pins, [{ path: sw.output_path, sha256: sha(specOut('Footer')) }, { path: ds.output_path, sha256: sha(text) }]);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

test('the designer: a bad design or an inherit-mode question is MISSING_EVIDENCE with a reissue; a design changed on disk blocks approve; rework gate1 respawns both agents with the note and their previous output', (t) => {
  const w = world();
  const s = 'sa';
  const { id, c, wt } = toSpecDesign(w, s, t);
  const [sw, ds] = c.next().steps;
  c.claim(sw.step_id);
  c.claim(ds.step_id);
  fails(c.agent(ds, designOut({ sections: ['Components to use', 'States'] }), 'ag-d1'), 'MISSING_EVIDENCE', /no `## Accessibility floor` section/);
  const d2 = c.take(byKind('spawn', 'designer'));
  assert.match(readFileSync(d2.brief_path, 'utf8'), /Your previous output was rejected[\s\S]*Accessibility floor/);
  fails(c.agent(d2, designOut({ front: { colors: {} } }), 'ag-d2'), 'MISSING_EVIDENCE', /colors must be a non-empty JSON object/);
  const d3 = c.take(byKind('spawn', 'designer'));
  fails(c.agent(d3, designOut({ question: questionBlock() }), 'ag-d3'), 'MISSING_EVIDENCE', /inherit mode asks no question[\s\S]*attempt 3 \(cap 3\): raised E1/);
  // 3-4: the third attempt in a row is the cap: Non-convergence, and retry buys one more.
  const nc = c.take(card('escalation'));
  assert.deepEqual([nc.card.title, nc.card.condition], ['Non-convergence (designer)', 3]);
  const rr = ok(decide(w, s, 'rule E1 retry no question in inherit mode', { cwd: wt }));
  const d4 = c.take(byKind('spawn', 'designer'));
  assert.deepEqual([d4.step_id, d4.attempt], [rr.reissued, 4]);
  const text = designOut();
  ok(c.agent(d4, text, 'ag-d4'));
  ok(c.agent(sw, specOut('Footer'), 'ag-spec'));
  assert.deepEqual(c.checks().map((x) => x.passed), [true]);
  c.take(card('gate_1'));
  // The design changed after it was verified: the pin no longer matches.
  writeFileSync(d4.output_path, text + 'one more line\n');
  fails(decide(w, s, 'approve gate1', { cwd: wt }), 'MISSING_EVIDENCE', /changed since it was verified/);
  writeFileSync(d4.output_path, text);
  // rework gate1: the spec and the design go back together.
  ok(decide(w, s, 'rework gate1 use the brand blue', { cwd: wt }));
  const rw = last(w, id, 'rework_requested');
  const dv = commands(w, id).find((e) => e.kind === 'step_verified' && e.data.step_id === d4.step_id);
  assert.ok(rw.data.voids.includes(sw.step_id) && rw.data.voids.includes(d4.step_id) && rw.data.voids.includes(dv.id), JSON.stringify(rw.data.voids));
  const n = c.next();
  assert.deepEqual(n.steps.map((x: any) => [x.agent, x.attempt]), [['d2t-factory:spec-writer', 2], ['d2t-factory:designer', 5]]);
  const brief = readFileSync(n.steps[1].brief_path, 'utf8');
  assert.ok(brief.includes('use the brand blue') && brief.includes(d4.output_path), brief);
  assert.ok(readFileSync(n.steps[0].brief_path, 'utf8').includes('use the brand blue'));
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

test('designer notes keep command order: /factory choose b, then rework gate1 <note>, and the rework note is the newest in the next designer brief', (t) => {
  const w = world();
  const s = 'sa';
  const { c, wt } = toSpecDesign(w, s, t, inventRecon());
  const [sw, ds] = c.next().steps;
  c.claim(sw.step_id);
  c.claim(ds.step_id);
  ok(c.agent(ds, designOut({ mode: 'invent', question: questionBlock() }), 'ag-d1'));
  ok(c.agent(sw, specOut('Footer'), 'ag-spec'));
  assert.deepEqual(c.checks().map((x) => x.passed), [true]);
  c.take(card('design_choice'));
  ok(decide(w, s, 'choose b', { cwd: wt }));
  const d2 = c.take(byKind('spawn', 'designer'));
  ok(c.agent(d2, designOut({ mode: 'invent' }), 'ag-d2'));
  c.take(card('gate_1'));
  ok(decide(w, s, 'rework gate1 make it light after all', { cwd: wt }));
  const d3 = c.next().steps.find(byKind('spawn', 'designer'));
  const brief = readFileSync(d3.brief_path, 'utf8');
  const choice = brief.indexOf('/factory choose b');
  const rework = brief.indexOf('make it light after all');
  assert.ok(choice >= 0 && rework > choice, brief);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

// --- 3-3: the slicer and the reviewer roster -----------------------------------------------------

const ALL_REVIEWERS = ['reviewer-code', 'reviewer-security', 'reviewer-ux', 'reviewer-a11y', 'reviewer-ui'];
// A running-app reviewer's FINDINGS: each finding cites the observed page state.
const observedOut = (role: string, ...scenarios: string[]): string =>
  `VERDICT: FINDINGS\n${scenarios.map((x, i) => `\n\`\`\`finding\ncategory: Bug\nlocation: signup.js:${i + 1}\nfailure_scenario: ${x}\nobserved: http://127.0.0.1/signup after submit [/tmp/${role}-${i + 1}.png]\n\`\`\`\n`).join('')}`;
const agents = (n: any): string[] => n.steps.map((x: any) => x.agent ?? x.check);

// … → spec + design (brownfield, a UI surface, not UI-free) → gate 1 → the slicer's plan → the
// gate_2 card, claimed. The contract's dev server is `sleep` with health `true` unless `o` says otherwise.
function toGate2Design(w: World, s: string, t: TestContext, slices: PlanSlice[], o: Record<string, unknown> = {}) {
  const r = toSpecDesign(w, s, t, reconOut(), o);
  const [sw, ds] = r.c.next().steps;
  r.c.claim(sw.step_id);
  r.c.claim(ds.step_id);
  ok(r.c.agent(sw, specOut('Footer'), 'ag-spec'));
  ok(r.c.agent(ds, designOut(), 'ag-design'));
  assert.deepEqual(r.c.checks().map((x) => x.name), ['spec.lint']);
  r.c.take(card('gate_1'));
  ok(decide(w, s, 'approve gate1', { cwd: r.wt }));
  const slicer = r.c.plan(slices);
  assert.ok(readFileSync(slicer.brief_path, 'utf8').includes(`the approved design (pinned at gate 1): ${ds.output_path}`), 'the slicer reads the approved design');
  const gate2 = r.c.take(card('gate_2'));
  return { ...r, sw, ds, slicer, gate2, port: portOf(w, r.id) };
}

test('acceptance (3-3): with a design, the slicer plans S1 [ui, input] and S2 ← S1; gate 2 shows both rosters and embeds tags, deps and rosters; S1 reviews with code, security and health, then ux, a11y and ui; only the raising reviewer re-checks; S2 reviews with reviewer-code only; the merge pins every rostered review', (t) => {
  const w = world();
  const s = 'sa';
  const r = toGate2Design(w, s, t, [{ id: 'S1', title: 'Signup form', acs: ['AC-1'], tags: ['ui', 'input'] }, { id: 'S2', title: 'Welcome mail', acs: ['AC-2'], depends_on: ['S1'] }], { e2e: 'npx playwright test' });
  const { id, c, wt } = r;
  assert.equal(r.gate2.card.reason, '2 slices: S1 Signup form (AC-1) [ui, input] · code, security, ux, a11y, ui; S2 Welcome mail (AC-2) ← S1 · code');
  assert.deepEqual(r.gate2.card.commands, ['/factory approve gate2', '/factory rework gate2 <note…>']);
  assert.equal(ok(decide(w, s, 'approve gate2', { cwd: wt })).phase, 'BUILD');
  assert.deepEqual(last(w, id, 'gate_2_passed').data.slices, [
    { id: 'S1', title: 'Signup form', acs: ['AC-1'], tags: ['ui', 'input'], deps: [], roster: ALL_REVIEWERS },
    { id: 'S2', title: 'Welcome mail', acs: ['AC-2'], tags: [], deps: ['S1'], roster: ['reviewer-code'] },
  ]);
  assert.deepEqual([stateOf(w, id).slices.S1.tags, stateOf(w, id).slices.S2.deps], [['ui', 'input'], ['S1']]);

  // S1, round 1: builder → test → the diff reviewers and health, together.
  const b1 = c.take(byKind('spawn', 'builder'));
  assert.match(readFileSync(b1.brief_path, 'utf8'), /tags of S1: ui, input/);
  ok(builds(r, b1, { 'signup.js': '1\n' }, 'ag-b1'));
  assert.deepEqual(c.checks().map((x) => [x.name, x.passed]), [['contract.test', true]]);
  const n1 = c.next();
  assert.deepEqual(agents(n1), ['d2t-factory:reviewer-code', 'd2t-factory:reviewer-security', 'contract.health']);
  const [code1, sec1, health1] = n1.steps;
  for (const st of n1.steps) c.claim(st.step_id);
  const secBrief = readFileSync(sec1.brief_path, 'utf8');
  assert.ok(secBrief.includes(`review this diff: git diff ${stateOf(w, id).base_sha}..${headOf(wt)}`) && secBrief.includes('tags of S1: ui, input') && secBrief.includes(r.sw.output_path), secBrief);
  assert.ok(secBrief.includes('The factory may restart the dev server while you review'), secBrief);
  const pidOf = (): number => JSON.parse(readFileSync(join(runDir(w, id), 'devserver.pid'), 'utf8')).pid;
  const before = pidOf();
  assert.equal(c.check(health1.step_id).passed, true);
  assert.notEqual(pidOf(), before, 'BUILD health restarted the dev server at the slice head');
  assert.equal(last(w, id, 'check_ran').data.sha, headOf(wt), 'health judged the slice head');
  // Health passed: the running-app reviewers follow while the diff reviewers are still at work.
  const n2 = c.next();
  assert.deepEqual(agents(n2), ['d2t-factory:reviewer-ux', 'd2t-factory:reviewer-a11y', 'd2t-factory:reviewer-ui']);
  const [ux1, a11y1, ui1] = n2.steps;
  for (const st of n2.steps) c.claim(st.step_id);
  const uxBrief = readFileSync(ux1.brief_path, 'utf8');
  for (const want of [
    `the running app: http://127.0.0.1:${r.port}`, 'mcp__plugin_d2t-factory_playwright-ux__browser_navigate, ', 'call browser_close first', 'observed: <url> <state> [<screenshot>]', 'run contract from SCAFFOLD',
    "the repo's e2e tooling: `npx playwright test`", `reviewer-ui is on this slice's roster (reference: ${r.ds.output_path})`, '`<step_id>-<n>.png`',
  ]) {
    assert.ok(uxBrief.includes(want), `${want} in\n${uxBrief}`);
  }
  assert.ok(!uxBrief.includes('__*') && !uxBrief.includes('browser_run_code_unsafe') && !uxBrief.includes('browser_file_upload'), uxBrief);
  assert.ok(!uxBrief.includes('review this diff'), 'a running-app reviewer judges the app, not the diff');
  assert.match(readFileSync(a11y1.brief_path, 'utf8'), /objective accessibility failures only/);
  assert.ok(readFileSync(ui1.brief_path, 'utf8').includes(`reference to compare the running app against: ${r.ds.output_path}`));
  // A running-app finding without `observed:` is MISSING_EVIDENCE and a reissue.
  writeFileSync(ux1.output_path, findingsOut('The form clears on submit'));
  fails(c.done(ux1.step_id), 'MISSING_EVIDENCE', /finding 1: observed is missing/);
  const ux2 = c.take(byKind('spawn', 'reviewer-ux'));
  assert.equal(ux2.attempt, 2);
  ok(c.agent(ux2, approveOut(), 'ag-ux'));
  ok(c.agent(a11y1, approveOut(), 'ag-a11y'));
  ok(c.agent(ui1, approveOut(), 'ag-ui'));
  ok(c.agent(code1, approveOut(), 'ag-code'));
  assert.equal(ok(c.agent(sec1, findingsOut('A name with <script> is echoed unescaped'), 'ag-sec')).state, 'verified');
  // Partial findings: a builder round, then only security re-checks; then S1 closes.
  const b2 = c.take(byKind('resume', 'builder'));
  assert.match(readFileSync(b2.brief_path, 'utf8'), /reviewer-security returned FINDINGS[\s\S]*echoed unescaped/);
  ok(builds(r, b2, { 'signup.js': '2\n' }, 'ag-b1'));
  assert.deepEqual(c.checks().map((x) => x.name), ['contract.test']);
  const n3 = c.next();
  assert.deepEqual(agents(n3), ['d2t-factory:reviewer-security']);
  c.claim(n3.steps[0].step_id);
  ok(c.agent(n3.steps[0], approveOut(), 'ag-sec-2'));

  // S2: its round is today's: builder → test → reviewer-code, no health.
  const b3 = c.take(byKind('spawn', 'builder'));
  assert.deepEqual([b3.slice, stateOf(w, id).slices.S1.state, stateOf(w, id).slices.S1.rounds], ['S2', 'CLOSED', 1]);
  ok(builds(r, b3, { 'mail.js': '1\n' }, 'ag-b3'));
  assert.deepEqual(c.checks().map((x) => x.name), ['contract.test']);
  const n4 = c.next();
  assert.deepEqual(agents(n4), ['d2t-factory:reviewer-code']);
  c.claim(n4.steps[0].step_id);
  ok(c.agent(n4.steps[0], approveOut(), 'ag-code-2'));

  // WRAP: the merge card shows each rostered reviewer's verdict; the merge pins every review.
  assert.deepEqual(c.wrapChecks().map((x) => [x.name, x.passed]), [['contract.health', true], ['contract.test', true]]);
  const m = c.take(card('merge'));
  assert.match(m.card.reason, /^S1 Signup form · reviewer-code APPROVE, reviewer-security APPROVE, reviewer-ux APPROVE, reviewer-a11y APPROVE, reviewer-ui APPROVE · 1 round · S2 Welcome mail · reviewer-code APPROVE · 0 rounds · /);
  assert.equal(ok(decide(w, s, 'merge', { cwd: wt })).phase, 'MERGED');
  assert.deepEqual(last(w, id, 'merge_approved').data.pins.map((p: any) => p.path), [r.sw.output_path, ...[code1, n3.steps[0], ux2, a11y1, ui1, n4.steps[0]].map((st) => st.output_path)]);
  // The board: each slice card carries its tags and roster.
  const cmds = commands(w, id);
  const lane = projectRun({ state: fold(cmds), commands: cmds, facts: [], skipped: [] }, { repo_hash: 'h', run_id: id });
  assert.deepEqual(lane.cards.filter((x) => x.kind === 'slice').map((x) => [x.id, x.tags, x.roster]), [['slice:S1', ['ui', 'input'], ALL_REVIEWERS], ['slice:S2', [], ['reviewer-code']]]);
  for (const e of cmds) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(stateOf(w, id).rejected, []);
});

test('the slicer (3-3): a schema error is MISSING_EVIDENCE and a reissue; a lint error reaches gate 2 with rework only; rework gate2 respawns the slicer with the note and its previous plan', (t) => {
  const w = world();
  const s = 'sa';
  const r = toScaffold(w, s, t);
  const { id, c } = r;
  ok(c.agent(c.take(byKind('spawn', 'scaffolder')), scaffoldOut(contract(r.port, NO_SERVER)), 'ag-scaffold'));
  c.checks();
  ok(c.agent(c.take(byKind('spawn', 'spec-writer')), specOut('Footer'), 'ag-spec'));
  c.checks();
  c.take(card('gate_1'));
  ok(decide(w, s, 'approve gate1', { cwd: c.cwd }));
  // Not a JSON list, then an unknown tag: rejected by the schema, reissued with the error.
  const sl1 = c.take(byKind('spawn', 'slicer'));
  assert.match(readFileSync(sl1.brief_path, 'utf8'), /tags` only from ui, input, auth, secrets, external/);
  fails(c.agent(sl1, 'STATUS: DONE\n---\nslices: S1, S2\n---\n', 'ag-sl1'), 'MISSING_EVIDENCE', /slices must be a single-line JSON list/);
  const sl2 = c.take(byKind('spawn', 'slicer'));
  assert.equal(sl2.attempt, 2);
  fails(c.agent(sl2, slicerOut([{ id: 'S1', title: 'x', acs: ['AC-1', 'AC-2'], tags: ['db'] }]), 'ag-sl2'), 'MISSING_EVIDENCE', /tag "db" is not one of/);
  // A plan that parses but fails the lint: a later dependency, an unknown and an uncovered AC.
  const sl3 = c.take(byKind('spawn', 'slicer'));
  ok(c.agent(sl3, slicerOut([{ id: 'S1', title: 'a', acs: ['AC-1', 'AC-9'], depends_on: ['S2'] }, { id: 'S2', title: 'b', acs: ['AC-1'] }]), 'ag-sl3'));
  assert.deepEqual(c.checks().map((x) => [x.name, x.passed]), [['plan.lint', false]]);
  const g = c.take(card('gate_2'));
  assert.deepEqual(g.card.commands, ['/factory rework gate2 <note…>']);
  assert.match(g.card.reason, /plan\.lint failed: S1: AC-9 is not in the spec; S1: depends on S2, which is not an earlier slice; AC-2 is in no slice$/);
  fails(decide(w, s, 'approve gate2', { cwd: c.cwd }), 'MISSING_EVIDENCE', /no passing plan\.lint/);
  ok(decide(w, s, 'rework gate2 cover AC-2 and drop the dependency', { cwd: c.cwd }));
  const rw = last(w, id, 'rework_requested');
  const sv = commands(w, id).find((e) => e.kind === 'step_verified' && e.data.step_id === sl3.step_id);
  assert.ok(rw.data.voids.includes(sl3.step_id) && rw.data.voids.includes(sv.id), JSON.stringify(rw.data.voids));
  const sl4 = c.take(byKind('spawn', 'slicer'));
  assert.equal(sl4.attempt, 4, 'two reissues, then the rework');
  const brief = readFileSync(sl4.brief_path, 'utf8');
  assert.ok(brief.includes('cover AC-2 and drop the dependency') && brief.includes(`the previous slice plan, sent back at gate 2: ${sl3.output_path}`), brief);
  ok(c.agent(sl4, slicerOut(), 'ag-sl4'));
  assert.deepEqual(c.checks().map((x) => [x.name, x.passed]), [['plan.lint', true]]);
  c.take(card('gate_2'));
  assert.equal(ok(decide(w, s, 'approve gate2', { cwd: c.cwd })).phase, 'BUILD');
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: c.cwd }));
});

test('overrides and UI-free (3-3): remove security and add a11y reach every slice, a UI-free ui slice gets no ux or ui; a failing health check is a builder round citing its log; at the cap Non-convergence names each reviewer still at FINDINGS', (t) => {
  const w = world();
  const s = 'sa';
  const overrides = { reviewer_overrides: { add: ['reviewer-a11y'], remove: ['reviewer-security'] } };
  const r = toGate2(w, s, t, { ...NO_SERVER, health: 'test ! -f unhealthy' }, overrides, [
    { id: 'S1', title: 'Signup form', acs: ['AC-1'], tags: ['input', 'ui'] }, { id: 'S2', title: 'Footer', acs: ['AC-2'] },
  ]);
  const { id, c, wt } = r;
  assert.equal(r.gate2.card.reason, '2 slices: S1 Signup form (AC-1) [input, ui] · code, a11y; S2 Footer (AC-2) · code, a11y');
  ok(decide(w, s, 'approve gate2', { cwd: wt }));
  // Round 0: the app does not come up at the builder's commit: health fails, a11y never runs.
  const b1 = c.take(byKind('spawn', 'builder'));
  ok(builds(r, b1, { 'signup.js': '1\n', unhealthy: 'x\n' }, 'ag-b1'));
  c.checks();
  const n1 = c.next();
  assert.deepEqual(agents(n1), ['d2t-factory:reviewer-code', 'contract.health']);
  for (const st of n1.steps) c.claim(st.step_id);
  assert.equal(c.check(n1.steps[1].step_id).passed, false);
  assert.deepEqual(c.next().steps, [], 'reviewer-code is still at work: no builder yet');
  ok(c.agent(n1.steps[0], findingsOut('The form posts to the wrong route'), 'ag-code-1'));
  const b2 = c.take(byKind('resume', 'builder'));
  const brief = readFileSync(b2.brief_path, 'utf8');
  assert.ok(/contract\.health failed \(exit 1\)/.test(brief) && brief.includes(n1.steps[1].output_path) && /reviewer-code returned FINDINGS[\s\S]*wrong route/.test(brief), brief);
  // Round 1: healthy; code re-checks (FINDINGS) and a11y runs for the first time (behind health).
  ok(builds(r, b2, { 'signup.js': '2\n', unhealthy: null }, 'ag-b1'));
  c.checks();
  const n2 = c.next();
  assert.deepEqual(agents(n2), ['d2t-factory:reviewer-code', 'contract.health']);
  for (const st of n2.steps) c.claim(st.step_id);
  assert.equal(c.check(n2.steps[1].step_id).passed, true);
  const a2 = c.take(byKind('spawn', 'reviewer-a11y'));
  assert.ok(!readFileSync(a2.brief_path, 'utf8').includes('e2e tooling'), 'no e2e in the contract: no e2e fact');
  ok(c.agent(n2.steps[0], findingsOut('Still the wrong route'), 'ag-code-2'));
  ok(c.agent(a2, observedOut('reviewer-a11y', 'The email field has no label', 'Focus is lost after submit'), 'ag-a11y-2'));
  // Round 2: both re-check and still find; the cap.
  const b3 = c.take(byKind('resume', 'builder'));
  ok(builds(r, b3, { 'signup.js': '3\n' }, 'ag-b1'));
  c.checks();
  const n3 = c.next();
  assert.deepEqual(agents(n3), ['d2t-factory:reviewer-code', 'contract.health']);
  for (const st of n3.steps) c.claim(st.step_id);
  c.check(n3.steps[1].step_id);
  const a3 = c.take(byKind('spawn', 'reviewer-a11y'));
  ok(c.agent(n3.steps[0], findingsOut('Still wrong'), 'ag-code-3'));
  ok(c.agent(a3, observedOut('reviewer-a11y', 'The email field has no label'), 'ag-a11y-3'));
  const nc = c.take(card('escalation'));
  assert.equal(nc.card.reason, 'S1 is not done after 2 builder rounds: reviewer-code still reports 1 finding, reviewer-a11y still reports 1 finding');
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

test('Non-convergence (3-3): contract.health still failing on the capped round names it on the card', (t) => {
  const w = world();
  const s = 'sa';
  const r = toGate2(w, s, t, { ...NO_SERVER, health: 'test ! -f unhealthy' }, { reviewer_overrides: { add: ['reviewer-a11y'], remove: [] } });
  const { id, c, wt } = r;
  ok(decide(w, s, 'approve gate2', { cwd: wt }));
  // Round 0: code approves, health fails; then two builder rounds where only a11y is due, behind a failing health.
  const b1 = c.take(byKind('spawn', 'builder'));
  ok(builds(r, b1, { unhealthy: 'x\n' }, 'ag-b1'));
  c.checks();
  const n1 = c.next();
  assert.deepEqual(agents(n1), ['d2t-factory:reviewer-code', 'contract.health']);
  for (const st of n1.steps) c.claim(st.step_id);
  assert.equal(c.check(n1.steps[1].step_id).passed, false);
  ok(c.agent(n1.steps[0], approveOut(), 'ag-code'));
  for (const round of [1, 2]) {
    const b = c.take(byKind('resume', 'builder'));
    ok(builds(r, b, { [`f${round}.js`]: `${round}\n` }, 'ag-b1'));
    c.checks();
    const n = c.next();
    assert.deepEqual(agents(n), ['contract.health'], `round ${round}: reviewer-code approved; a11y waits behind health`);
    c.claim(n.steps[0].step_id);
    assert.equal(c.check(n.steps[0].step_id).passed, false);
  }
  const nc = c.take(card('escalation'));
  assert.equal(nc.card.reason, 'S1 is not done after 2 builder rounds: contract.health still fails (exit 1)');
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

// --- 3-4: the full build loop and escalations ------------------------------------------------------

const roleOf = (st: any): string => st.agent?.replace('d2t-factory:', '') ?? st.check ?? st.kind;
// The BUILD steps issued so far, as `role slice`, in command order.
const buildSteps = (w: World, id: string): string[] =>
  commands(w, id).filter((e) => e.kind === 'step_issued' && e.data.stage === 'BUILD' && e.data.kind !== 'ask_human').map((e) => `${e.data.role ?? e.data.check} ${e.data.slice}`);
// Move a command's ts back by `ms` in commands.jsonl (the time box reads wall time from it).
function backdate(w: World, id: string, pred: (e: any) => boolean, ms: number): void {
  const file = join(runDir(w, id), 'commands.jsonl');
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
    const e = JSON.parse(l);
    return JSON.stringify(pred(e) ? { ...e, ts: new Date(Date.parse(e.ts) - ms).toISOString() } : e);
  });
  writeFileSync(file, lines.join('\n') + '\n');
}

test('acceptance (3-4): S1, S2 independent and S3 ← S2; S1\'s FINDINGS during S2\'s build queue and are fixed (S1 resumed) before S2\'s test; S3 starts once S2 closes; the merge card lists all three; every command validates', (t) => {
  const w = world();
  const s = 'sa';
  const r = toGate2(w, s, t, NO_SERVER, {}, [
    { id: 'S1', title: 'Footer markup', acs: ['AC-1'] }, { id: 'S2', title: 'Footer text', acs: ['AC-2'] }, { id: 'S3', title: 'Footer link', acs: ['AC-2'], depends_on: ['S2'] },
  ]);
  const { id, c, wt } = r;
  ok(decide(w, s, 'approve gate2', { cwd: wt }));
  const S = (x: string) => stateOf(w, id).slices[x];
  // S1 builds alone; its test passes.
  const b1 = c.take(byKind('spawn', 'builder'));
  assert.equal(b1.slice, 'S1');
  ok(builds(r, b1, { 's1.js': '1\n' }, 'ag-b1'));
  assert.deepEqual(c.checks().map((x) => [x.name, x.passed]), [['contract.test', true]]);
  // Pipeline: one next issues S1's diff reviewer, and starts S2 with its builder.
  const n1 = c.next();
  assert.deepEqual(n1.steps.map((x: any) => [roleOf(x), x.slice, x.kind]), [['reviewer-code', 'S1', 'spawn'], ['builder', 'S2', 'spawn']]);
  assert.deepEqual([S('S2').state, S('S3').state], ['BUILDING', 'BACKLOG']);
  const [rv1, b2] = n1.steps;
  c.claim(b2.step_id);
  c.claim(rv1.step_id);
  const rbrief = readFileSync(rv1.brief_path, 'utf8');
  const sha1 = stateOf(w, id).steps[b1.step_id].sha!;
  for (const want of [`git show ${sha1}:<path>`, 'S2 is being built in the worktree right now: run no tests', `S1's own commits: ${sha1}. Review only the changes these commits make`]) {
    assert.ok(rbrief.includes(want), `${want} in\n${rbrief}`);
  }
  // S1's reviewer raises FINDINGS while S2's builder is claimed: queued.
  ok(c.agent(rv1, findingsOut('The footer markup is not closed'), 'ag-rv1'));
  assert.equal(S('S1').state, 'FINDINGS_QUEUED');
  assert.deepEqual(c.next().steps, [], 'the builder is busy on S2: nothing beside it');
  // S2's builder done: the builder goes back to S1 (resumed) before S2's test.
  ok(builds(r, b2, { 's2.js': '1\n' }, 'ag-b2'));
  const b3 = c.take(byKind('resume', 'builder'));
  assert.deepEqual([b3.slice, b3.agent_id, S('S1').rounds], ['S1', 'ag-b1', 1]);
  assert.match(readFileSync(b3.brief_path, 'utf8'), /## Your last round on S1 did not pass[\s\S]*not closed/);
  ok(builds(r, b3, { 's1.js': '2\n' }, 'ag-b1'));
  const n2 = c.next();
  assert.deepEqual(n2.steps.map((x: any) => [roleOf(x), x.slice]), [['contract.test', 'S1']], 'S1\'s test first');
  c.claim(n2.steps[0].step_id);
  assert.equal(c.check(n2.steps[0].step_id).passed, true);
  const n3 = c.next();
  assert.deepEqual(n3.steps.map((x: any) => [roleOf(x), x.slice]), [['reviewer-code', 'S1'], ['contract.test', 'S2']], 'only reviewer-code on S1; S2\'s test beside it');
  for (const st of n3.steps) c.claim(st.step_id);
  assert.equal(c.check(n3.steps[1].step_id).passed, true);
  const rbrief2 = readFileSync(n3.steps[0].brief_path, 'utf8');
  assert.ok(rbrief2.includes('no other slice is being built in the worktree right now: you may run the tests'), rbrief2);
  assert.ok(rbrief2.includes(`S1's own commits: ${sha1}, ${stateOf(w, id).steps[b3.step_id].sha}.`), rbrief2);
  ok(c.agent(n3.steps[0], approveOut(), 'ag-rv2'));
  // S1 closes; S2's reviewer follows; S3 waits for S2.
  const rv3 = c.take(byKind('spawn', 'reviewer-code'));
  assert.deepEqual([rv3.slice, S('S1').state, S('S3').state], ['S2', 'CLOSED', 'BACKLOG']);
  ok(c.agent(rv3, approveOut(), 'ag-rv3'));
  const b4 = c.take(byKind('spawn', 'builder'));
  assert.deepEqual([b4.slice, S('S2').state], ['S3', 'CLOSED']);
  const kinds = commands(w, id).filter((e) => (e.kind === 'slice_closed' || e.kind === 'slice_started') && ['S2', 'S3'].includes(e.data.slice)).map((e) => `${e.kind} ${e.data.slice}`);
  assert.deepEqual(kinds, ['slice_started S2', 'slice_closed S2', 'slice_started S3']);
  ok(builds(r, b4, { 's3.js': '1\n' }, 'ag-b4'));
  assert.deepEqual(c.checks().map((x) => x.passed), [true]);
  ok(c.agent(c.take(byKind('spawn', 'reviewer-code')), approveOut(), 'ag-rv4'));
  // The step order of the Queued findings row, then S3.
  assert.deepEqual(buildSteps(w, id), [
    'builder S1', 'contract.test S1', 'reviewer-code S1', 'builder S2', 'builder S1', 'contract.test S1', 'reviewer-code S1', 'contract.test S2', 'reviewer-code S2',
    'builder S3', 'contract.test S3', 'reviewer-code S3',
  ]);
  assert.deepEqual(c.wrapChecks().map((x) => [x.name, x.passed]), [['contract.health', true], ['contract.test', true]]);
  // git.deps diffed each slice's own commits: no dependency changed.
  assert.deepEqual(commands(w, id).filter((e) => e.kind === 'check_ran' && e.data.check === 'git.deps').map((e) => e.data.exit_code), [0, 0, 0]);
  const m = c.take(card('merge'));
  assert.match(m.card.reason, /^S1 Footer markup · reviewer-code APPROVE · 1 round · S2 Footer text · reviewer-code APPROVE · 0 rounds · S3 Footer link · reviewer-code APPROVE · 0 rounds · /);
  assert.deepEqual(m.card.commands, ['/factory merge', '/factory rework S1 <note…>', '/factory rework S2 <note…>', '/factory rework S3 <note…>', '/factory abandon']);
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

test('time box (3-4): a slice over its box raises `Over time box: S1 at 31 / 30 min.` (condition 3) while its reviewer works; cut cancels that step (done is then ILLEGAL_TRANSITION) and keeps its commits; retry grants another box and its note goes to that slice\'s builder', (t) => {
  const w = world();
  const s = 'sa';
  const r = toGate2(w, s, t, NO_SERVER, {}, [{ id: 'S1', title: 'Footer markup', acs: ['AC-1'] }, { id: 'S2', title: 'Footer text', acs: ['AC-2'] }]);
  const { id, c, wt } = r;
  ok(decide(w, s, 'approve gate2', { cwd: wt }));
  const S = (x: string) => stateOf(w, id).slices[x];
  const b1 = c.take(byKind('spawn', 'builder'));
  ok(builds(r, b1, { 's1.js': '1\n' }, 'ag-b1'));
  c.checks();
  const n1 = c.next();
  const [rv1, b2] = n1.steps;
  assert.deepEqual([roleOf(rv1), roleOf(b2)], ['reviewer-code', 'builder']);
  c.claim(rv1.step_id);
  c.claim(b2.step_id);
  // 31 min since S1 started: the CLI raises the time box; the reviewer in flight is left alone.
  backdate(w, id, (e) => e.kind === 'slice_started' && e.data.slice === 'S1', 31 * 60_000);
  const tb = c.take(card('escalation'));
  assert.deepEqual({ title: tb.card.title, label: tb.card.reason_label, reason: tb.card.reason, commands: tb.card.commands, condition: tb.card.condition }, {
    title: 'Over time box (S1)', label: 'Over time box', reason: 'S1 at 31 / 30 min.', commands: ['/factory rule E1 retry <note…>', '/factory rule E1 cut', '/factory abandon'], condition: 3,
  });
  assert.deepEqual([S('S1').state, stateOf(w, id).steps[rv1.step_id].state], ['ESCALATED', 'claimed']);
  fails(decide(w, s, 'rule E1 accept', { cwd: wt }), 'ILLEGAL_TRANSITION', /retry <note…> or cut/);
  const sha1 = stateOf(w, id).steps[b1.step_id].sha!;
  // A second escalation on the ESCALATED slice: the in-flight reviewer escalates; its ask carries no slice.
  assert.equal(ok(c.agent(rv1, 'VERDICT: ESCALATE\nSpec ambiguity: the markup spec names two footers\n', 'ag-rv1')).escalation, 'E2');
  const e2 = last(w, id, 'ask_raised');
  assert.deepEqual([e2.data.escalation, 'slice' in e2.data, e2.data.step_id, S('S1').state], ['E2', false, rv1.step_id, 'ESCALATED']);
  assert.deepEqual(stateOf(w, id).rejected, []);
  const card2 = c.next().steps.find((x: any) => x.card?.escalation === 'E2');
  assert.ok(card2, 'the E2 card is due');
  // cut: S1 to CUT, its open reviewer cancelled (which closes E2 and cancels its card), the role
  // free; the budget cut is not decided.
  ok(decide(w, s, 'rule E1 cut', { cwd: wt }));
  c.next();
  const cancels = commands(w, id).filter((e) => e.kind === 'step_cancelled').map((e) => [e.data.step_id, e.data.reason]);
  assert.deepEqual(cancels, [[rv1.step_id, 'slice S1 is cut'], [card2.step_id, 'E2 is closed']]);
  const st1 = stateOf(w, id);
  assert.deepEqual([st1.slices.S1.state, st1.cut_decided, st1.steps[rv1.step_id].state, Object.values(st1.asks).find((a) => a.escalation === 'E2')!.open], ['CUT', false, 'cancelled', false]);
  fails(decide(w, s, 'rule E2 retry', { cwd: wt }), 'ILLEGAL_TRANSITION', /no open escalation E2/);
  fails(c.done(rv1.step_id), 'ILLEGAL_TRANSITION', /is cancelled/);
  assert.ok(isAncestorOf(wt, sha1), 'S1\'s commit stays on the run branch');
  // S2 goes on: its builder, then (40 min in) its own time box; retry grants a second box.
  ok(builds(r, b2, { 's2.js': '1\n' }, 'ag-b2'));
  c.checks();
  const rv2 = c.take(byKind('spawn', 'reviewer-code'));
  assert.equal(rv2.slice, 'S2', 'the reviewer role is free again and takes S2');
  backdate(w, id, (e) => e.kind === 'slice_started' && e.data.slice === 'S2', 40 * 60_000);
  const tb2 = c.take(card('escalation'));
  assert.match(tb2.card.reason, /^S2 at 40 \/ 30 min\.$/);
  ok(decide(w, s, 'rule E3 retry keep the text short', { cwd: wt }));
  assert.equal(S('S2').state, 'IN_REVIEW', 'its evidence: the builder is done, the round under review');
  assert.deepEqual(c.next().steps, [], 'not over again: the limit is now 60 min');
  ok(c.agent(rv2, findingsOut('The text overflows'), 'ag-rv2'));
  const b3 = c.take(byKind('resume', 'builder'));
  assert.equal(b3.slice, 'S2');
  assert.match(readFileSync(b3.brief_path, 'utf8'), /E3 retry: keep the text short[\s\S]*S2 at 40 \/ 30 min/);
  const lane = projectRun({ state: fold(commands(w, id)), commands: commands(w, id), facts: [], skipped: [] }, { repo_hash: 'h', run_id: id });
  const s2 = lane.cards.find((x) => x.id === 'slice:S2')!;
  assert.equal(s2.timebox_min, 60);
  assert.equal(lane.deadlines.timebox_ends_at, s2.timebox_ends_at);
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

const isAncestorOf = (wt: string, sha: string): boolean => spawnSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: wt }).status === 0;

test('reissue cap (3-4): a builder output that fails to parse on attempt 3 raises Non-convergence (condition 3) and parks the slice; retry is attempt 4; a resume whose agent is gone (done, no output) is reissued as a spawn', (t) => {
  const w = world();
  const s = 'sa';
  const r = toBuild(w, s, t);
  const { id, c, wt } = r;
  for (const attempt of [1, 2]) {
    const b = c.take(byKind('spawn', 'builder'));
    assert.equal(b.attempt, attempt);
    writeFileSync(b.output_path, 'done\n');
    fails(c.done(b.step_id), 'MISSING_EVIDENCE', /reissued as step/);
  }
  const b3 = c.take(byKind('spawn', 'builder'));
  assert.equal(b3.attempt, 3);
  writeFileSync(b3.output_path, 'done\n');
  fails(c.done(b3.step_id), 'MISSING_EVIDENCE', /that was attempt 3 \(cap 3\): raised E1 \(Non-convergence\)/);
  fails(c.done(b3.step_id), 'ILLEGAL_TRANSITION', /subject of open escalation E1/);
  assert.equal(commands(w, id).filter((e) => e.kind === 'ask_raised').length, 1, 'no duplicate Non-convergence');
  const raised = last(w, id, 'ask_raised');
  assert.deepEqual([raised.data.step_id, raised.data.slice, raised.data.card.condition, raised.data.card.reason_label], [b3.step_id, 'S1', 3, 'Non-convergence']);
  assert.equal(stateOf(w, id).slices.S1.state, 'ESCALATED');
  const nc = c.take(card('escalation'));
  assert.deepEqual({ title: nc.card.title, commands: nc.card.commands }, { title: 'Non-convergence (builder on S1)', commands: ['/factory rule E1 retry <note…>', '/factory abandon'] });
  assert.match(nc.card.reason, /builder on S1 failed 3 attempts: line 1 must be/);
  assert.ok(!commands(w, id).some((e) => e.kind === 'step_reissued' && e.data.old === b3.step_id), 'no reissue');
  assert.deepEqual(c.next().steps.filter((x: any) => x.kind !== 'ask_human'), [], 'nothing new for the ESCALATED slice');
  const rr = ok(decide(w, s, 'rule E1 retry write line 1 exactly', { cwd: wt }));
  const b4 = c.take(byKind('spawn', 'builder'));
  assert.deepEqual([b4.step_id, b4.attempt, stateOf(w, id).slices.S1.state], [rr.reissued, 4, 'BUILDING']);
  assert.match(readFileSync(b4.brief_path, 'utf8'), /E1 retry: write line 1 exactly/);
  ok(builds(r, b4, { 'footer.js': '1\n' }, 'ag-b4'));
  c.checks();
  ok(c.agent(c.take(byKind('spawn', 'reviewer-code')), findingsOut('The footer is empty'), 'ag-rv1'));
  // The round resumes ag-b4; SendMessage cannot reach it: done finds no output, and the step comes back as a spawn.
  const res = c.take(byKind('resume', 'builder'));
  assert.equal(res.agent_id, 'ag-b4');
  fails(c.done(res.step_id), 'MISSING_EVIDENCE', /no output file/);
  const again = c.take(byKind('spawn', 'builder'));
  assert.deepEqual([again.attempt, again.agent_id, again.slice], [2, undefined, 'S1']);
  const re = last(w, id, 'step_reissued');
  assert.deepEqual([re.data.old, re.data.new, re.data.kind], [res.step_id, again.step_id, 'spawn']);
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

test('rerun (3-4): refused while an agent step is open; at an escalation card in BUILD `/factory rerun SLICE_PLAN` clears the slices, closes the asks, cancels the card and its subject, and a fresh slicer plans on top of the built commits', (t) => {
  const w = world();
  const s = 'sa';
  const r = toBuild(w, s, t);
  const { id, c, wt } = r;
  const b1 = c.take(byKind('spawn', 'builder'));
  fails(decide(w, s, 'rerun SLICE_PLAN', { cwd: wt }), 'ILLEGAL_TRANSITION', new RegExp(`only while parked at a card; step ${b1.step_id} \\(builder\\) is claimed`));
  fails(decide(w, s, 'rerun FRAME', { cwd: wt }), 'ILLEGAL_TRANSITION', /5-2/);
  writeFileSync(join(wt, 'footer.js'), 'half\n');
  ok(c.agent(b1, 'STATUS: ESCALATE\nScope change: the footer needs a settings page first\n', 'ag-b1'));
  c.take(card('escalation'));
  // A retry note of the old plan's S1, then the builder escalates again.
  ok(decide(w, s, 'rule E1 retry old plan footer only', { cwd: wt }));
  const b1b = c.take(byKind('spawn', 'builder'));
  assert.match(readFileSync(b1b.brief_path, 'utf8'), /E1 retry: old plan footer only/);
  ok(c.agent(b1b, 'STATUS: ESCALATE\nScope change: still needs a settings page\n', 'ag-b1b'));
  const esc = c.take(card('escalation'));
  assert.deepEqual([esc.card.escalation, esc.card.condition], ['E2', 1]);
  const built = headOf(wt);
  const rr = ok(decide(w, s, 'rerun SLICE_PLAN', { cwd: wt }));
  assert.deepEqual([rr.phase, rr.stage], ['SLICE_PLAN', 'SLICE_PLAN']);
  const st = stateOf(w, id);
  assert.deepEqual([st.slice_order, Object.values(st.asks).map((a) => a.open), st.steps[esc.step_id].state, st.steps[b1b.step_id].state], [[], [false, false], 'cancelled', 'cancelled']);
  const voids = last(w, id, 'stage_rerun_requested').data.voids;
  for (const v of [r.slicer.step_id, b1b.step_id, last(w, id, 'gate_2_passed').id]) assert.ok(voids.includes(v), `${v} voided`);
  assert.ok(!voids.includes(r.spec.step_id), 'the spec stands');
  // A fresh slicer, on top of the commits already built.
  const sl2 = c.take(byKind('spawn', 'slicer'));
  assert.equal(sl2.attempt, 2);
  assert.equal(headOf(wt), built, 'the run branch is not reset');
  ok(c.agent(sl2, slicerOut([{ id: 'S1', title: 'Settings page', acs: ['AC-1', 'AC-2'] }]), 'ag-sl2'));
  assert.deepEqual(c.checks().map((x) => [x.name, x.passed]), [['plan.lint', true]]);
  c.take(card('gate_2'));
  assert.equal(ok(decide(w, s, 'approve gate2', { cwd: wt })).phase, 'BUILD');
  const b2 = c.take(byKind('spawn', 'builder'));
  assert.deepEqual([b2.slice, stateOf(w, id).slices.S1.title], ['S1', 'Settings page']);
  assert.doesNotMatch(readFileSync(b2.brief_path, 'utf8'), /old plan footer only/, 'the old plan\'s S1 notes stay with it');
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

test('rerun RECON (3-4) at gate 1: a fresh recon overwrites the cache, SCAFFOLD is skipped over the verified scaffolder, and a fresh spec-writer follows', (t) => {
  const w = world();
  const s = 'sa';
  const r = toScaffold(w, s, t);
  const { id, c } = r;
  ok(c.agent(c.take(byKind('spawn', 'scaffolder')), scaffoldOut(contract(r.port, NO_SERVER)), 'ag-scaffold'));
  c.checks();
  const sw1 = c.take(byKind('spawn', 'spec-writer'));
  ok(c.agent(sw1, specOut('Footer'), 'ag-spec'));
  c.checks();
  c.take(card('gate_1'));
  const cache = last(w, id, 'stage_completed').data.recon?.path ?? commands(w, id).find((e) => e.kind === 'stage_completed' && e.data.stage === 'RECON').data.recon.path;
  assert.equal(ok(decide(w, s, 'rerun RECON', { cwd: c.cwd })).phase, 'ORIENT');
  const rc = c.take(byKind('spawn', 'recon'));
  assert.equal(rc.attempt, 2);
  const fresh = reconOut().replace('# Map', '# Map (fresh)');
  ok(c.agent(rc, fresh, 'ag-recon-2'));
  const sw2 = c.take(byKind('spawn', 'spec-writer'));
  assert.equal(sw2.attempt, 2);
  assert.equal(readFileSync(cache, 'utf8'), fresh, 'the cache is overwritten');
  assert.deepEqual(commands(w, id).filter((e) => e.kind === 'stage_completed').map((e) => e.data.stage), ['RECON', 'RECON', 'SCAFFOLD']);
  assert.equal(commands(w, id).filter((e) => e.kind === 'step_issued' && e.data.role === 'scaffolder').length, 1, 'no second scaffolder');
  assert.equal(stateOf(w, id).phase, 'SPEC_DESIGN');
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: c.cwd }));
});

test('git.deps (3-4) diffs only the slice\'s own builder commits: a dependency S1 added and the human accepted is not raised again when S2 closes', (t) => {
  const w = world();
  const s = 'sa';
  const r = toGate2(w, s, t, NO_SERVER, {}, [{ id: 'S1', title: 'Pad', acs: ['AC-1'] }, { id: 'S2', title: 'Text', acs: ['AC-2'] }]);
  const { id, c, wt } = r;
  ok(decide(w, s, 'approve gate2', { cwd: wt }));
  const pkg = readFileSync(join(wt, 'package.json'), 'utf8');
  const b1 = c.take(byKind('spawn', 'builder'));
  ok(builds(r, b1, { 'pad.js': '1\n', 'package.json': pkg.replace('"private": true', '"private": true,\n  "dependencies": { "left-pad": "1.3.0" }') }, 'ag-b1'));
  c.checks();
  const [rv1, b2] = c.next().steps;
  c.claim(rv1.step_id);
  c.claim(b2.step_id);
  ok(c.agent(rv1, approveOut(), 'ag-rv1'));
  const nd = c.take(card('escalation'));
  assert.deepEqual([nd.card.title, nd.card.reason, nd.card.condition], ['New dependency (S1)', 'package.json', 2]);
  ok(decide(w, s, 'rule E1 accept', { cwd: wt }));
  ok(builds(r, b2, { 'text.js': '1\n' }, 'ag-b2'));
  c.checks();
  assert.equal(stateOf(w, id).slices.S1.state, 'CLOSED', 'accepted: S1 closed');
  ok(c.agent(c.take(byKind('spawn', 'reviewer-code')), approveOut(), 'ag-rv2'));
  c.wrapChecks();
  assert.deepEqual(commands(w, id).filter((e) => e.kind === 'check_ran' && e.data.check === 'git.deps').map((e) => e.data.exit_code), [1, 1, 0], 'S1 twice (raised, then accepted), S2 clean');
  assert.equal(stateOf(w, id).slices.S2.state, 'CLOSED');
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

test('cut while the builder works (3-4): an Over time box `cut` of S1 with its builder claimed issues no new builder until that builder\'s done, which commits and reports it unverified; then it is cancelled. S1\'s retry note never reaches S2\'s builder', (t) => {
  const w = world();
  const s = 'sa';
  const r = toGate2(w, s, t, NO_SERVER, {}, [{ id: 'S1', title: 'Footer markup', acs: ['AC-1'] }, { id: 'S2', title: 'Footer text', acs: ['AC-2'] }]);
  const { id, c, wt } = r;
  ok(decide(w, s, 'approve gate2', { cwd: wt }));
  const S = (x: string) => stateOf(w, id).slices[x];
  const b0 = c.take(byKind('spawn', 'builder'));
  ok(c.agent(b0, 'STATUS: ESCALATE\nSpec ambiguity: one footer or two?\n', 'ag-b0'));
  c.take(card('escalation'));
  ok(decide(w, s, 'rule E1 retry s1 one footer only', { cwd: wt }));
  const b1 = c.take(byKind('spawn', 'builder'));
  assert.equal(b1.slice, 'S1');
  backdate(w, id, (e) => e.kind === 'slice_started' && e.data.slice === 'S1', 31 * 60_000);
  const tb = c.take(card('escalation'));
  assert.equal(tb.card.escalation, 'E2');
  ok(decide(w, s, 'rule E2 cut', { cwd: wt }));
  // S2 starts, but its builder waits: S1's builder still holds the worktree.
  const n = c.next();
  assert.deepEqual([S('S1').state, S('S2').state, stateOf(w, id).steps[b1.step_id].state], ['CUT', 'BUILDING', 'claimed']);
  assert.ok(!n.steps.some((x: any) => x.agent === 'd2t-factory:builder'), JSON.stringify(n));
  assert.ok(!commands(w, id).some((e) => e.kind === 'step_cancelled'));
  // Its done commits and reports; nothing verifies it; next cancels it and S2's builder follows.
  const d = ok(builds(r, b1, { 'footer.js': 'cut work\n' }, 'ag-b1'));
  assert.equal(d.state, 'reported');
  const sha = stateOf(w, id).steps[b1.step_id].sha!;
  assert.ok(!commands(w, id).some((e) => e.kind === 'step_verified' && e.data.step_id === b1.step_id));
  const b2 = c.take(byKind('spawn', 'builder'));
  assert.equal(b2.slice, 'S2');
  const cancelled = last(w, id, 'step_cancelled');
  assert.deepEqual([cancelled.data.step_id, cancelled.data.reason], [b1.step_id, 'slice S1 is cut']);
  assert.ok(isAncestorOf(wt, sha), 'the cut slice\'s commit stays on the run branch');
  assert.doesNotMatch(readFileSync(b2.brief_path, 'utf8'), /E1 retry|s1 one footer only/, 'S1\'s retry note is not S2\'s');
  for (const e of commands(w, id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

test('git.deps (3-4) with interleaved commits: S2\'s package.json change, committed between S1\'s two commits, is not raised when S1 closes; S2 raises it at its own close', (t) => {
  const w = world();
  const s = 'sa';
  const r = toGate2(w, s, t, NO_SERVER, {}, [{ id: 'S1', title: 'Pad', acs: ['AC-1'] }, { id: 'S2', title: 'Text', acs: ['AC-2'] }]);
  const { id, c, wt } = r;
  ok(decide(w, s, 'approve gate2', { cwd: wt }));
  const pkg = readFileSync(join(wt, 'package.json'), 'utf8');
  const b1 = c.take(byKind('spawn', 'builder'));
  ok(builds(r, b1, { 'pad.js': '1\n' }, 'ag-b1'));
  c.checks();
  const [rv1, b2] = c.next().steps;
  c.claim(rv1.step_id);
  c.claim(b2.step_id);
  ok(c.agent(rv1, findingsOut('pad() pads on the wrong side'), 'ag-rv1'));
  ok(builds(r, b2, { 'text.js': '1\n', 'package.json': pkg.replace('"private": true', '"private": true,\n  "dependencies": { "left-pad": "1.3.0" }') }, 'ag-b2'));
  const b3 = c.take(byKind('resume', 'builder'));
  assert.equal(b3.slice, 'S1');
  ok(builds(r, b3, { 'pad.js': '2\n' }, 'ag-b1'));
  assert.deepEqual(c.checks().map((x) => x.passed), [true]);
  const n = c.next();
  for (const st of n.steps) c.claim(st.step_id);
  for (const st of n.steps.filter((x: any) => x.kind === 'run_check')) c.check(st.step_id);
  ok(c.agent(n.steps.find((x: any) => x.slice === 'S1'), approveOut(), 'ag-rv2'));
  ok(c.agent(c.take(byKind('spawn', 'reviewer-code')), approveOut(), 'ag-rv3'));
  const nd = c.take(card('escalation'));
  assert.deepEqual([nd.card.title, nd.card.reason], ['New dependency (S2)', 'package.json']);
  assert.equal(stateOf(w, id).slices.S1.state, 'CLOSED');
  const deps = commands(w, id).filter((e) => e.kind === 'check_ran' && e.data.check === 'git.deps').map((e) => e.data.exit_code);
  assert.deepEqual(deps, [0, 1], 'S1 clean, S2 raised');
  assert.deepEqual(stateOf(w, id).rejected, []);
  ok(decide(w, s, 'abandon', { cwd: wt }));
});

test('orphans at the reissue cap (3-4): an agent stopped without output through three takeovers raises one Non-convergence, and later nexts neither reissue it nor raise again', () => {
  const w = world();
  const { id, c } = started(w, 'sa');
  const takeover = (to: string) => { say(w, to, `resume ${id}`); ok(run(w, ['resume', id, '--session', to])); return conductor(w, to); };
  let st = c.take(byKind('spawn', 'recon'));
  agentStops(w, 'sa', st.agent, 'ag-1');
  for (const [to, n] of [['sb', 2], ['sc', 3]] as const) {
    st = takeover(to).take(byKind('spawn', 'recon'));
    assert.equal(st.attempt, n);
    agentStops(w, to, st.agent, `ag-${n}`);
  }
  const d = takeover('sd');
  const n1 = d.next();
  const raised = commands(w, id).filter((e) => e.kind === 'ask_raised');
  assert.equal(raised.length, 1);
  assert.deepEqual([raised[0].data.step_id, raised[0].data.card.title, raised[0].data.card.condition], [st.step_id, 'Non-convergence (recon)', 3]);
  assert.deepEqual(n1.steps.map((x: any) => [x.kind, x.card?.escalation]), [['ask_human', 'E1']]);
  const before = commands(w, id).length;
  d.next();
  d.next();
  assert.ok(!commands(w, id).slice(before).some((e) => e.kind === 'ask_raised' || e.kind === 'step_reissued'), 'nothing more for it');
  assert.equal(commands(w, id).filter((e) => e.kind === 'step_reissued' && e.data.old === st.step_id).length, 0);
  ok(decide(w, 'sd', 'abandon'));
});

// --- 5-1: parallel runs, the exclusive claim and multi-run recording ------------------------------

const repoHashOf = (w: World, id: string): string => stateOf(w, id).repo_hash!;
const exclusiveDirOf = (w: World, id: string): string => join(w.home, repoHashOf(w, id), 'exclusive');

test('parallel (5-1): two runs in one repo, interleaved to run_completed, on their own branches and ports with no exclusive claim; the resume list shows both with title and slice; the main checkout is untouched; claims go only after run_completed is on disk', (t) => {
  const w = world();
  const before = git(w.repo, 'status', '--porcelain=v2');
  const tasks = ['add a footer', 'add a header'];
  const files = ['footer.js', 'header.js'];
  const runs = (['sa', 'sb'] as const).map((s, i) => ({ s, ...started(w, s, tasks[i]), wt: '' }));
  t.after(() => { for (const r of runs) run(w, ['devserver', 'down', '--session', r.s]); });
  const each = <T>(f: (r: (typeof runs)[number], i: number) => T): T[] => runs.map(f);

  // RECON for both (B's first next comes before A's recon is cached, so both spawn one).
  const recons = each((r) => r.c.take(byKind('spawn', 'recon')));
  each((r, i) => assert.equal(ok(r.c.agent(recons[i], reconOut(), `ag-recon-${r.s}`)).state, 'verified'));
  const enters = each((r) => r.c.take(byKind('enter_worktree')));
  each((r, i) => { r.wt = enters[i].path; r.c.cwd = r.wt; assert.equal(ok(r.c.done(enters[i].step_id)).state, 'verified'); });
  const ports = each((r) => portOf(w, r.id));
  assert.notEqual(ports[0], ports[1], 'distinct ports');
  assert.notEqual(runs[0].wt, runs[1].wt);
  // SCAFFOLD, SPEC, gate 1, the plan, gate 2: one stage at a time, A then B.
  const scs = each((r) => r.c.take(byKind('spawn', 'scaffolder')));
  each((r, i) => ok(r.c.agent(scs[i], scaffoldOut(contract(ports[i], NO_SERVER)), `ag-scaffold-${r.s}`)));
  each((r) => assert.deepEqual(r.c.checks().map((x) => x.passed), [true, true]));
  const specs = each((r) => r.c.take(byKind('spawn', 'spec-writer')));
  each((r, i) => ok(r.c.agent(specs[i], specOut(tasks[i]), `ag-spec-${r.s}`)));
  each((r) => assert.deepEqual(r.c.checks().map((x) => x.passed), [true]));
  each((r) => { r.c.take(card('gate_1')); ok(decide(w, r.s, 'approve gate1', { cwd: r.c.cwd })); });
  each((r, i) => r.c.plan([{ id: 'S1', title: tasks[i], acs: ['AC-1', 'AC-2'] }], `ag-slicer-${r.s}`));
  each((r) => { r.c.take(card('gate_2')); assert.equal(ok(decide(w, r.s, 'approve gate2', { cwd: r.c.cwd })).phase, 'BUILD'); });
  assert.equal(existsSync(exclusiveDirOf(w, runs[0].id)), false, 'no shared service: no exclusive claim');

  // BUILD: both builders at work. A bare /factory in the main checkout lists both runs.
  const bs = each((r) => r.c.take(byKind('spawn', 'builder')));
  say(w, 'sx', '');
  const list = ok(run(w, ['decide', '--session', 'sx'])).resolution.list;
  assert.deepEqual(list.map((x: any) => [x.run_id, x.title, x.stage, x.slice]).sort(), each((r, i) => [r.id, tasks[i], 'BUILD', 'S1']).sort());
  assert.ok(list.every((x: any) => typeof x.last_ts === 'string'));
  each((r, i) => {
    writeFileSync(join(r.wt, files[i]), `module.exports = '${files[i]}';\n`);
    ok(r.c.agent(bs[i], builderOut(`Added ${files[i]}`), `ag-b-${r.s}`));
  });
  each((r) => assert.deepEqual(r.c.checks().map((x) => [x.name, x.passed]), [['contract.test', true]]));
  const rvs = each((r) => r.c.take(byKind('spawn', 'reviewer-code')));
  each((r, i) => assert.equal(ok(r.c.agent(rvs[i], approveOut(), `ag-rv-${r.s}`)).state, 'verified'));
  each((r) => assert.deepEqual(r.c.wrapChecks().map((x) => x.passed), [true, true]));
  each((r) => r.c.take(card('merge')));
  // Each worktree holds only its own run's change.
  assert.deepEqual(each((r, i) => [existsSync(join(r.wt, files[i])), existsSync(join(r.wt, files[1 - i]))]), [[true, false], [true, false]]);

  // A merges and completes. Its run_completed cannot be appended at first: its claims stay.
  const [A, B] = runs;
  assert.equal(ok(decide(w, A.s, 'merge', { cwd: A.wt })).phase, 'MERGED');
  const exA = A.c.take(byKind('exit_worktree'));
  A.c.cwd = w.repo;
  ok(A.c.done(exA.step_id));
  const portA = join(w.home, 'ports', String(ports[0]));
  if (process.getuid?.() !== 0) {
    const log = join(runDir(w, A.id), 'commands.jsonl');
    chmodSync(log, 0o444);
    assert.notEqual(run(w, ['next', '--session', A.s]).code, 0, 'the append fails');
    chmodSync(log, 0o644);
    assert.equal(stateOf(w, A.id).phase, 'MERGED');
    assert.equal(existsSync(portA), true, 'not released before run_completed is on disk');
  }
  const finA = A.c.next();
  assert.equal(finA.done, true);
  assert.equal(last(w, A.id, 'run_completed').kind, 'run_completed');
  assert.equal(existsSync(portA), false, 'released once the fold is terminal');
  assert.equal(existsSync(join(w.home, 'ports', String(ports[1]))), true, "B's port is still B's");

  // B: its card is stale (the target moved with A's merge); fresh checks on the integrated head, then merge.
  assert.deepEqual(B.c.wrapChecks().map((x) => x.passed), [true, true]);
  B.c.take(card('merge'));
  assert.equal(ok(decide(w, B.s, 'merge', { cwd: B.wt })).phase, 'MERGED');
  const exB = B.c.take(byKind('exit_worktree'));
  B.c.cwd = w.repo;
  ok(B.c.done(exB.step_id));
  assert.equal(B.c.next().done, true);

  for (const [i, r] of runs.entries()) {
    const s = stateOf(w, r.id);
    assert.deepEqual([s.phase, s.branch, last(w, r.id, 'run_completed').kind], ['COMPLETED', `factory/${r.id}`, 'run_completed']);
    assert.equal(git(w.repo, 'merge-base', '--is-ancestor', `factory/${r.id}`, 'HEAD'), '', `factory/${r.id} is merged`);
    assert.equal(existsSync(join(w.home, 'ports', String(ports[i]))), false);
    assert.equal(existsSync(r.wt), false, 'the worktree is gone');
    assert.deepEqual(s.rejected, []);
    for (const e of commands(w, r.id)) assert.ok(validateEvent(e).ok, JSON.stringify(e));
  }
  assert.deepEqual(git(w.repo, 'branch', '--list', 'factory/*', '--format=%(refname:short)').trim().split('\n').sort(), each((r) => `factory/${r.id}`).sort());
  assert.deepEqual(files.map((f) => readFileSync(join(w.repo, f), 'utf8')), files.map((f) => `module.exports = '${f}';\n`));
  assert.equal(git(w.repo, 'status', '--porcelain=v2'), before, "the main checkout's git status is unchanged");
  assert.equal(existsSync(exclusiveDirOf(w, A.id)), false);
});

const SHARED = { ...NO_SERVER, services: [{ name: 'postgres', shared: true }] };

// Two runs, sa and sb, each at SCAFFOLD inside its worktree. Both are started before either has a
// recon to cache, so each spawns its own.
function bothAtScaffold(w: World, t: TestContext) {
  const rs = (['sa', 'sb'] as const).map((s, i) => ({ s, ...started(w, s, ['add a footer', 'add a header'][i]) })).map((r) => {
    t.after(() => { run(w, ['devserver', 'down', '--session', r.s]); });
    return { ...r, recon: r.c.take(byKind('spawn', 'recon')) };
  }).map((r) => {
    ok(r.c.agent(r.recon, reconOut(), `ag-recon-${r.s}`));
    const enter = r.c.take(byKind('enter_worktree'));
    r.c.cwd = enter.path;
    ok(r.c.done(enter.step_id));
    return { ...r, port: portOf(w, r.id) };
  });
  assert.notEqual(rs[0].port, rs[1].port);
  return rs;
}

// The run's scaffolder reports `o`'s contract and both checks pass; returns the scaffolder step.
function scaffolds(r: ReturnType<typeof bothAtScaffold>[number], o: Record<string, unknown>) {
  const sc = r.c.take(byKind('spawn', 'scaffolder'));
  ok(r.c.agent(sc, scaffoldOut(contract(r.port, o)), `ag-scaffold-${r.s}`));
  assert.deepEqual(r.c.checks().map((x) => x.passed), [true, true]);
  return sc;
}

const refusal = (id: string): string => `Run refused — ${id} is live in this repo and its run contract lists a shared database. One run per repo.`;

test('one run per repo (5-1): while A holds exclusive/, B with no shared service is refused at the end of SCAFFOLD, retry and abandon only', (t) => {
  const w = world();
  const [A, B] = bothAtScaffold(w, t);
  scaffolds(A, SHARED);
  A.c.take(byKind('spawn', 'spec-writer'));
  assert.equal(readFileSync(join(exclusiveDirOf(w, A.id), 'run'), 'utf8'), `${A.id}\n`);
  const scB = scaffolds(B, NO_SERVER);
  const crd = B.c.take(card('scaffold_failure'));
  assert.equal(crd.card.reason, refusal(A.id));
  assert.deepEqual(crd.card.commands, ['/factory rule E1 retry <note…>', '/factory abandon']);
  assert.equal(stateOf(w, B.id).steps[scB.step_id].state, 'reported', 'not verified');
  assert.equal(readFileSync(join(exclusiveDirOf(w, A.id), 'run'), 'utf8'), `${A.id}\n`, "still A's");
  ok(decide(w, 'sa', 'abandon', { cwd: A.c.cwd }));
  ok(decide(w, 'sb', 'abandon', { cwd: B.c.cwd }));
});

test('one run per repo (5-1): with B already past SCAFFOLD, shared-service A gives its fresh claim back and is refused naming B', (t) => {
  const w = world();
  const [A, B] = bothAtScaffold(w, t);
  scaffolds(B, NO_SERVER);
  B.c.take(byKind('spawn', 'spec-writer'));
  assert.equal(stateOf(w, B.id).phase, 'SPEC_DESIGN');
  const scA = scaffolds(A, SHARED);
  const crd = A.c.take(card('scaffold_failure'));
  assert.equal(crd.card.reason, refusal(B.id));
  assert.deepEqual(crd.card.commands, ['/factory rule E1 retry <note…>', '/factory abandon']);
  assert.equal(stateOf(w, A.id).steps[scA.step_id].state, 'reported', 'not verified');
  const excl = exclusiveDirOf(w, A.id);
  assert.equal(existsSync(excl), false, 'the fresh claim is released');
  assert.deepEqual(readdirSync(join(excl, '..')).filter((n) => n.startsWith('exclusive')), []);
  ok(decide(w, 'sa', 'abandon', { cwd: A.c.cwd }));
  ok(decide(w, 'sb', 'abandon', { cwd: B.c.cwd }));
});

test('a stale exclusive claim at SCAFFOLD (5-1): exclusive/run naming a missing run is broken and re-claimed; the scaffolder is verified', (t) => {
  const w = world();
  const r = toScaffold(w, 'sa', t);
  const excl = exclusiveDirOf(w, r.id);
  mkdirSync(excl);
  writeFileSync(join(excl, 'run'), 'gone-zzzz\n');
  const sc = r.c.take(byKind('spawn', 'scaffolder'));
  ok(r.c.agent(sc, scaffoldOut(contract(r.port, SHARED)), 'ag-scaffold'));
  assert.deepEqual(r.c.checks().map((x) => x.passed), [true, true]);
  r.c.take(byKind('spawn', 'spec-writer'));
  assert.equal(stateOf(w, r.id).steps[sc.step_id].state, 'verified');
  assert.equal(commands(w, r.id).some((e) => e.kind === 'ask_raised'), false, 'no scaffold_failure');
  assert.equal(readFileSync(join(excl, 'run'), 'utf8'), `${r.id}\n`);
  assert.deepEqual(readdirSync(join(excl, '..')).filter((n) => n.startsWith('exclusive')), ['exclusive'], 'no exclusive.* left aside');
  ok(decide(w, 'sa', 'abandon', { cwd: r.c.cwd }));
});

test('shared service (5-1): A holds the exclusive claim from SCAFFOLD; a start is refused naming A; B, started earlier, gets a scaffold_failure card with retry and abandon only; after A ends, retry claims it', (t) => {
  const w = world();
  const [A, B] = bothAtScaffold(w, t);
  const excl = exclusiveDirOf(w, A.id);
  // A's SCAFFOLD completes and claims the repo.
  const scA = A.c.take(byKind('spawn', 'scaffolder'));
  ok(A.c.agent(scA, scaffoldOut(contract(A.port, SHARED)), 'ag-scaffold-a'));
  assert.deepEqual(A.c.checks().map((x) => x.passed), [true, true]);
  A.c.take(byKind('spawn', 'spec-writer'));
  assert.equal(readFileSync(join(excl, 'run'), 'utf8'), `${A.id}\n`);
  // A third start: refused before anything is claimed.
  const p = say(w, 'sc', 'add a sidebar');
  const refused = run(w, ['start', '--session', 'sc']);
  fails(refused, 'REFUSED_EXCLUSIVE');
  const text = `Run refused — ${A.id} is live in this repo and its run contract lists a shared database. One run per repo.`;
  assert.equal(refused.out.error.message, text);
  assert.equal(consumed(w, p), null);
  assert.deepEqual(readdirSync(join(w.home, repoHashOf(w, A.id), 'runs')).sort(), [A.id, B.id].sort());
  // B reaches the end of SCAFFOLD: the card, its reason the refusal text, no accept.
  const scB = B.c.take(byKind('spawn', 'scaffolder'));
  ok(B.c.agent(scB, scaffoldOut(contract(B.port, SHARED)), 'ag-scaffold-b'));
  assert.deepEqual(B.c.checks().map((x) => x.passed), [true, true]);
  const crd = B.c.take(card('scaffold_failure'));
  assert.equal(crd.card.reason, text);
  assert.deepEqual(crd.card.commands, ['/factory rule E1 retry <note…>', '/factory abandon']);
  fails(decide(w, 'sb', 'rule E1 accept', { cwd: B.c.cwd }), 'ILLEGAL_TRANSITION');
  assert.equal(readFileSync(join(excl, 'run'), 'utf8'), `${A.id}\n`, 'still A\'s');
  // A ends: its port and the claim go with run_abandoned.
  assert.equal(ok(decide(w, 'sa', 'abandon', { cwd: A.c.cwd })).phase, 'ABANDONED');
  assert.equal(existsSync(excl), false);
  assert.equal(existsSync(join(w.home, 'ports', String(A.port))), false);
  // B's retry: a fresh scaffolder, the same checks, and this time the claim is B's.
  const rr = ok(decide(w, 'sb', 'rule E1 retry A is gone', { cwd: B.c.cwd }));
  const scB2 = B.c.take(byKind('spawn', 'scaffolder'));
  assert.equal(scB2.step_id, rr.reissued);
  ok(B.c.agent(scB2, scaffoldOut(contract(B.port, SHARED)), 'ag-scaffold-b2'));
  assert.deepEqual(B.c.checks().map((x) => x.passed), [true, true]);
  B.c.take(byKind('spawn', 'spec-writer'));
  assert.equal(stateOf(w, B.id).steps[scB2.step_id].state, 'verified');
  assert.equal(readFileSync(join(excl, 'run'), 'utf8'), `${B.id}\n`);
  assert.equal(ok(decide(w, 'sb', 'abandon', { cwd: B.c.cwd })).phase, 'ABANDONED');
  assert.equal(existsSync(excl), false);
  for (const id of [A.id, B.id]) assert.deepEqual(stateOf(w, id).rejected, []);
});

test('record --runs a,b (5-1): one session bound to both runs brings its transcript once, and every file is redacted with the union of both runs\' redact values', () => {
  const w = world();
  const a = started(w, 'sa', 'add a footer').id;
  assert.equal(ok(decide(w, 'sa', 'abandon')).phase, 'ABANDONED');
  const b = started(w, 'sa', 'add a header').id; // the same session, bound to both runs
  const [va, vb] = ['alpha-only-secret-1111', 'bravo-only-secret-2222'];
  writeFileSync(join(runDir(w, a), 'redact.json'), JSON.stringify({ values: [va] }));
  writeFileSync(join(runDir(w, b), 'redact.json'), JSON.stringify({ values: [vb] }));
  // Each run's artifact holds the other run's value; the shared transcript holds both.
  for (const [id, v] of [[a, vb], [b, va]]) {
    mkdirSync(join(runDir(w, id), 'artifacts', 'steps', 'x'), { recursive: true });
    writeFileSync(join(runDir(w, id), 'artifacts', 'steps', 'x', 'out.md'), `STATUS: DONE\nsaw ${v}\n`);
  }
  appendFileSync(join(w.projects, '-repo', 'sa.jsonl'), JSON.stringify({ type: 'assistant', sessionId: 'sa', message: { content: `first ${va} then ${vb}` } }) + '\n');
  const rec = ok(run(w, ['record', 'both', '--runs', `${a},${b}`, '--session', 'sa']));
  assert.deepEqual(rec.runs.map((x: any) => [x.run_id, x.phase]), [[a, 'ABANDONED'], [b, 'ORIENT']]);
  assert.deepEqual(rec.transcripts, ['sa'], 'the shared transcript, once');
  const dir = join(w.home, 'recordings', 'both');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.runs, [a, b].map((id) => ({ repo_hash: repoHashOf(w, id), run_id: id })));
  const all = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => statSync(join(dir, f)).isFile());
  assert.ok(all.includes(join('transcripts', 'sa.jsonl')) && all.filter((f) => f.endsWith('commands.jsonl')).length === 2, all.join('\n'));
  for (const f of all) {
    const text = readFileSync(join(dir, f), 'utf8');
    assert.ok(!text.includes(va) && !text.includes(vb), `${f} leaks a value`);
  }
  assert.match(readFileSync(join(dir, 'transcripts', 'sa.jsonl'), 'utf8'), /first \[REDACTED\] then \[REDACTED\]/);
  for (const id of [a, b]) assert.match(readFileSync(join(dir, 'runs', repoHashOf(w, id), id, 'artifacts', 'steps', 'x', 'out.md'), 'utf8'), /saw \[REDACTED\]/);
  ok(decide(w, 'sa', 'abandon'));
});
