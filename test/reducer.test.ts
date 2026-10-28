import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AnyEvent } from '../src/core/events.ts';
import { validateEvent } from '../src/core/events.ts';
import { apply, boardStage, fold, initialState, isTerminal, openSteps } from '../src/core/reducer.ts';
import { readLines } from '../src/store/jsonl.ts';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (name: string): AnyEvent[] => readLines<AnyEvent>(join(FIX, `${name}.jsonl`)).items;

// Folded snapshots stay byte-identical unless a change is deliberate (AD-32).
for (const name of ['happy-path', 'findings-escalation-rework', 'illegal-then-abandon']) {
  test(`fixture ${name}: fold matches snapshot`, () => {
    const events = load(name);
    for (const e of events) assert.ok(validateEvent(e).ok, `fixture event ${e.id} invalid`);
    const got = JSON.stringify(fold(events), null, 2) + '\n';
    const snap = join(FIX, `${name}.state.json`);
    if (process.env.UPDATE_SNAPSHOTS || !existsSync(snap)) writeFileSync(snap, got);
    assert.equal(got, readFileSync(snap, 'utf8'));
  });
}

test('happy path reaches COMPLETED with nothing rejected', () => {
  const s = fold(load('happy-path'));
  assert.equal(s.phase, 'COMPLETED');
  assert.deepEqual(s.rejected, []);
  assert.equal(s.slices.S1.state, 'CLOSED');
  assert.equal(s.merged_sha, 'merge00');
  assert.ok(isTerminal(s));
  assert.equal(openSteps(s).length, 0);
});

test('findings, reissue, escalation, cut and rework drive the slice machine', () => {
  const s = fold(load('findings-escalation-rework'));
  assert.deepEqual(s.rejected, []);
  assert.equal(s.phase, 'BUILD');
  assert.equal(s.slices.S1.state, 'BUILDING'); // reworked after closing
  assert.equal(s.slices.S1.rounds, 1); // one FINDINGS round; rework doesn't count (AD-33)
  assert.equal(s.slices.S2.state, 'CUT');
  assert.ok(s.cut_decided);
  const reissued = Object.values(s.steps).filter((x) => x.state === 'reissued');
  assert.equal(reissued.length, 1);
  assert.equal(s.steps['01JQ0000000000000000000ZZZ'].attempt, 2);
  assert.equal(Object.values(s.asks)[0].open, false);
  assert.equal(s.voided.length, 1);
});

test('illegal events are rejected, not applied, and the run ends ABANDONED', () => {
  const s = fold(load('illegal-then-abandon'));
  assert.deepEqual(s.rejected.map((r) => r.kind), ['gate_2_passed', 'step_claimed', 'merged', 'stage_completed']);
  assert.equal(s.phase, 'ABANDONED');
  assert.equal(s.abandoned_from, 'ORIENT');
  assert.equal(boardStage(s), 'RECON');
});

test('apply is pure and reports why an event is illegal', () => {
  const s = fold(load('happy-path').slice(0, 3)); // started, bound, intake confirmed
  const before = JSON.stringify(s);
  const bad = load('happy-path').find((e) => e.kind === 'gate_1_passed')!;
  const r = apply(s, bad);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /gate_1_passed in ORIENT/);
  assert.equal(JSON.stringify(s), before);
  const good = load('happy-path').find((e) => e.kind === 'stage_completed')!;
  const r2 = apply(s, good);
  assert.equal(r2.ok, true);
  assert.equal(r2.state.phase, 'SCAFFOLD');
  assert.equal(s.phase, 'ORIENT');
});

test('facts never change state', () => {
  const s = fold(load('happy-path').slice(0, 2));
  const fact = { v: 1, id: '01JQ00000000000000000000FF', ts: '2026-10-24T10:00:00.000Z', run: s.run_id!, session: 'x', kind: 'tool_succeeded', actor: 'hook', corr: null, data: { tool_name: 'Bash' } } as AnyEvent;
  assert.equal(apply(s, fact).ok, false);
});

test('board stage follows the phase; greenfield orients as FRAME', () => {
  const s = initialState();
  s.run_id = 'r';
  s.phase = 'ORIENT';
  assert.equal(boardStage(s), 'RECON');
  s.greenfield = true;
  assert.equal(boardStage(s), 'FRAME');
  s.phase = 'MERGED';
  assert.equal(boardStage(s), 'WRAP');
});

// --- I/O matrix (story 1-1) -----------------------------------------------------------------------

test('fold is total: a command without data or with an unknown kind lands in rejected', () => {
  const events = load('happy-path');
  const issued = events.find((e) => e.kind === 'step_issued')!;
  const noData = { ...issued, id: '01JQ00000000000000000000M1' } as Partial<AnyEvent>;
  delete noData.data;
  const unknown = { ...events[3], id: '01JQ00000000000000000000M2', kind: 'made_up' } as unknown as AnyEvent;
  const s = fold([...events.slice(0, 2), noData as AnyEvent, unknown, ...events.slice(2)]);
  assert.equal(s.phase, 'COMPLETED');
  assert.equal(s.rejected.length, 2);
  assert.deepEqual(s.rejected[0].id, '01JQ00000000000000000000M1');
  assert.match(s.rejected[0].reason, /^malformed: /);
  assert.equal(s.rejected[1].kind, 'made_up');
  assert.doesNotThrow(() => fold([null as unknown as AnyEvent]));
  assert.match(fold([null as unknown as AnyEvent]).rejected[0].reason, /^malformed: /);
  assert.match(apply(fold(events.slice(0, 2)), noData as AnyEvent).reason!, /^malformed: /);
});

test('a throw partway through an event leaves no partial mutation behind', () => {
  const events = load('findings-escalation-rework');
  const rework = events[events.length - 1]; // rework S1: moves the slice, then spreads voids
  assert.equal(rework.kind, 'rework_requested');
  const bad = { ...rework, id: '01JQ00000000000000000000M3', data: { ...rework.data, voids: 5 } } as unknown as AnyEvent;
  const prefix = events.slice(0, -1);
  const s = fold([...prefix, bad]);
  assert.equal(s.slices.S1.state, 'CLOSED');
  assert.match(s.rejected[0].reason, /^malformed: /);
  assert.deepEqual({ ...s, rejected: [] }, fold(prefix));
});

test('BUILD cannot complete while a slice is neither CLOSED nor CUT', () => {
  const events = load('happy-path');
  const closed = events.findIndex((e) => e.kind === 'slice_closed');
  const done = events.find((e) => e.kind === 'stage_completed' && e.data.stage === 'BUILD')!;
  const r = apply(fold(events.slice(0, closed)), done);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'slice S1 is IN_REVIEW');
  assert.equal(apply(fold(events.slice(0, closed + 1)), done).ok, true);
  const cut = fold(load('findings-escalation-rework').slice(0, -1)); // S1 CLOSED, S2 CUT
  assert.deepEqual([cut.phase, cut.slices.S1.state, cut.slices.S2.state], ['BUILD', 'CLOSED', 'CUT']);
  const wrap = apply(cut, done);
  assert.ok(wrap.ok, wrap.reason);
  assert.equal(wrap.state.phase, 'WRAP');
});

test('one open step per role (AD-24); role-less steps and reissues are exempt', () => {
  const events = load('happy-path');
  let s = fold(events.slice(0, events.findIndex((e) => e.kind === 'slice_started') + 1));
  assert.equal(s.phase, 'BUILD');
  let n = 0;
  const issue = (data: object): AnyEvent => ({ v: 1, id: `01JQ00000000000000000000N${n++}`, ts: '2026-10-24T11:00:00.000Z', run: s.run_id!, kind: 'step_issued', actor: 'cli', corr: '', data: { kind: 'spawn', stage: 'BUILD', attempt: 1, ...data } } as AnyEvent);
  const first = issue({ role: 'builder', slice: 'S1' });
  s = apply(s, first).state;
  const second = apply(s, issue({ role: 'builder', slice: 'S1' }));
  assert.equal(second.ok, false);
  assert.match(second.reason!, /role builder already has open step/);
  assert.ok(apply(s, issue({ role: 'reviewer-code', slice: 'S1' })).ok);
  const a = apply(s, issue({ kind: 'run_check' }));
  assert.ok(a.ok);
  assert.ok(apply(a.state, issue({ kind: 'run_check' })).ok);
  const reissue = { ...first, id: '01JQ00000000000000000000R1', kind: 'step_reissued', data: { old: first.id, new: '01JQ00000000000000000000R2' } } as AnyEvent;
  const r = apply(s, reissue);
  assert.ok(r.ok, r.reason);
  assert.equal(r.state.steps['01JQ00000000000000000000R2'].role, 'builder');
});

// --- 1-5 ------------------------------------------------------------------------------------------

test('a builder round after a failing slice test (IN_REVIEW) counts like one after FINDINGS, spawn or resume; a builder in BUILDING does not', () => {
  const events = load('happy-path');
  const reviewer = events.findIndex((e) => e.kind === 'step_issued' && (e.data as { role?: string }).role === 'reviewer-code');
  let s = fold(events.slice(0, reviewer)); // the builder is verified: S1 IN_REVIEW
  assert.equal(s.slices.S1.state, 'IN_REVIEW');
  let n = 0;
  const ev = (kind: string, data: object): AnyEvent => ({ v: 1, id: `01JQ00000000000000000000P${n++}`, ts: '2026-10-24T11:00:00.000Z', run: s.run_id!, session: 'x', kind, actor: 'cli', corr: '', data } as AnyEvent);
  const round = ev('step_issued', { kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'builder', slice: 'S1' });
  s = apply(s, round).state;
  assert.deepEqual([s.slices.S1.state, s.slices.S1.rounds], ['BUILDING', 1]);
  s = apply(s, ev('step_claimed', { step_id: round.id })).state;
  s = apply(s, ev('step_verified', { step_id: round.id, evidence: [] })).state;
  assert.equal(s.slices.S1.state, 'IN_REVIEW');
  const resume = ev('step_issued', { kind: 'resume', stage: 'BUILD', attempt: 1, role: 'builder', agent_id: 'a', slice: 'S1' });
  s = apply(s, resume).state;
  assert.deepEqual([s.slices.S1.state, s.slices.S1.rounds], ['BUILDING', 2]);
});

test('rework S<n> from WRAP (before merged) returns the run to BUILD and clears merge_approved; after merged it is illegal', () => {
  const events = load('happy-path');
  const approved = events.findIndex((e) => e.kind === 'merge_approved');
  const wrap = fold(events.slice(0, approved + 1));
  assert.deepEqual([wrap.phase, wrap.merge_approved], ['WRAP', true]);
  const rework = { v: 1, id: '01JQ00000000000000000000Q1', ts: '2026-10-24T11:00:00.000Z', run: wrap.run_id!, session: 'x', kind: 'rework_requested', actor: 'human', corr: '', data: { prompt_fact_id: 'f', target: 'S1', note: 'bolder', voids: ['v1'] } } as AnyEvent;
  const r = apply(wrap, rework);
  assert.ok(r.ok, r.reason);
  assert.deepEqual([r.state.phase, r.state.slices.S1.state, r.state.slices.S1.rounds, r.state.merge_approved, r.state.voided], ['BUILD', 'BUILDING', 0, false, ['v1']]);
  const merged = fold(events.slice(0, events.findIndex((e) => e.kind === 'merged') + 1));
  assert.equal(merged.phase, 'MERGED');
  assert.match(apply(merged, rework).reason!, /rework S1 in MERGED/);
});

// --- 3-1 ----------------------------------------------------------------------------------------

const ev3 = (kind: string, data: object, o: { actor?: string } = {}): AnyEvent =>
  ({ v: 1, id: `X${kind}${Math.random()}`, ts: '2026-10-24T10:00:00.000Z', run: 'r', session: 's', kind, actor: o.actor ?? 'cli', corr: 'c', data }) as unknown as AnyEvent;
const started3 = (): AnyEvent => ev3('run_started', { task: 't', repo_hash: 'h', base_sha: 'b', branch: 'f/r' });

test('check_ran keeps git\'s error only when it carries one (additive, dry run 2)', () => {
  const s = fold([
    started3(),
    ev3('check_ran', { check: 'git.merged', exit_code: 1, duration_ms: 1, basis_seq: 1, error: 'no merges today' }),
    ev3('check_ran', { check: 'git.merged', exit_code: 0, duration_ms: 1, basis_seq: 1, sha: 'm' }),
  ]);
  assert.equal(s.checks[0].error, 'no merges today');
  assert.equal(Object.hasOwn(s.checks[1], 'error'), false);
  for (const e of [ev3('check_ran', { check: 'git.merged', exit_code: 1, duration_ms: 1, basis_seq: 1, error: 'x' })]) assert.ok(validateEvent({ ...e, id: '01JQ00000000000000000000Q2' }).ok);
});

test('intake_confirmed records the intake and the clock start only when it carries them (additive)', () => {
  const intake = { limit_min: 100, slice_timebox_min: 30, ui_free: true, reviewer_overrides: { add: [], remove: [] } };
  const s = fold([started3(), ev3('intake_confirmed', { prompt_fact_id: 'f', intake, clock_start: '2026-10-24T08:00:00.000Z' }, { actor: 'human' })]);
  assert.deepEqual([s.phase, s.intake, s.clock_start], ['ORIENT', intake, '2026-10-24T08:00:00.000Z']);
  const bare = fold([started3(), ev3('intake_confirmed', { prompt_fact_id: 'f' }, { actor: 'human' })]);
  assert.equal(bare.phase, 'ORIENT');
  assert.ok(!('intake' in bare) && !('clock_start' in bare), 'absent: older runs fold to the same state');
});

test('design_choice_made voids what its data.voids names (a non-default choice), and nothing without them (additive)', () => {
  const base = [started3(), ev3('intake_confirmed', { prompt_fact_id: 'f' }, { actor: 'human' })];
  assert.deepEqual(fold([...base, ev3('design_choice_made', { prompt_fact_id: 'f', choice: 'a' }, { actor: 'human' })]).voided, []);
  const s = fold([...base, ev3('design_choice_made', { prompt_fact_id: 'f', choice: 'b', voids: ['D1', 'D2'] }, { actor: 'human' })]);
  assert.deepEqual([s.voided, s.rejected], [['D1', 'D2'], []]);
  assert.ok(validateEvent({ ...ev3('design_choice_made', { prompt_fact_id: 'f', choice: 'b', voids: ['D1'] }, { actor: 'human' }), id: '01JQZZZZZZZZZZZZZZZZZZZ001' }).ok);
});

test('cut_decided closes the open cut ask; other open asks stay open', () => {
  const events = [
    started3(), ev3('intake_confirmed', { prompt_fact_id: 'f' }, { actor: 'human' }), ev3('stage_completed', { stage: 'RECON' }),
  ];
  let s = fold(events);
  const step = (kind: string, data: object, o: { actor?: string } = {}) => { const r = apply(s, ev3(kind, data, o)); assert.ok(r.ok, r.reason); s = r.state; };
  step('step_issued', { kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder' });
  const sc = s.step_order[0];
  step('step_claimed', { step_id: sc });
  step('step_verified', { step_id: sc, evidence: [] });
  step('gate_1_passed', { prompt_fact_id: 'f' }, { actor: 'human' });
  step('gate_2_passed', { prompt_fact_id: 'f', slices: [{ id: 'S1' }, { id: 'S2' }] }, { actor: 'human' });
  step('ask_raised', { card: { type: 'cut', title: 'Cut point reached', commands: [] } });
  step('ask_raised', { card: { type: 'escalation', title: 'x', commands: [] }, escalation: 'E1' });
  assert.deepEqual(Object.values(s.asks).map((a) => [a.card.type, a.open]), [['cut', true], ['escalation', true]]);
  assert.equal(apply(s, ev3('cut_decided', { prompt_fact_id: 'f', cut: ['S9'] }, { actor: 'human' })).ok, false);
  step('cut_decided', { prompt_fact_id: 'f', cut: ['S2'] }, { actor: 'human' });
  assert.deepEqual(Object.values(s.asks).map((a) => [a.card.type, a.open]), [['cut', false], ['escalation', true]]);
  assert.deepEqual([s.slices.S1.state, s.slices.S2.state, s.cut_decided], ['BACKLOG', 'CUT', true]);
});

test('gate_2_passed stores a slice\'s tags and roster only when the event carries them (3-3)', () => {
  const events = [
    started3(), ev3('intake_confirmed', { prompt_fact_id: 'f' }, { actor: 'human' }), ev3('stage_completed', { stage: 'RECON' }),
  ];
  let s = fold(events);
  const step = (kind: string, data: object, o: { actor?: string } = {}) => { const r = apply(s, ev3(kind, data, o)); assert.ok(r.ok, r.reason); s = r.state; };
  step('step_issued', { kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder' });
  step('step_claimed', { step_id: s.step_order[0] });
  step('step_verified', { step_id: s.step_order[0], evidence: [] });
  step('gate_1_passed', { prompt_fact_id: 'f' }, { actor: 'human' });
  step('gate_2_passed', { prompt_fact_id: 'f', slices: [
    { id: 'S1', title: 'Signup', acs: ['AC-1'], tags: ['ui'], deps: [], roster: ['reviewer-code', 'reviewer-ux', 'reviewer-a11y'] },
    { id: 'S2', title: 'Old style', acs: ['AC-2'], deps: ['S1'] },
  ] }, { actor: 'human' });
  assert.deepEqual(s.slices.S1, { id: 'S1', title: 'Signup', acs: ['AC-1'], notes: undefined, deps: [], state: 'BACKLOG', rounds: 0, tags: ['ui'], roster: ['reviewer-code', 'reviewer-ux', 'reviewer-a11y'] });
  assert.deepEqual(Object.keys(s.slices.S2), ['id', 'title', 'acs', 'notes', 'deps', 'state', 'rounds'], 'no tags or roster keys at all');
});

// --- 3-4 ----------------------------------------------------------------------------------------

// BUILD with S1 started and its builder claimed, at an escalation card.
function build34() {
  let s = fold([started3(), ev3('intake_confirmed', { prompt_fact_id: 'f' }, { actor: 'human' }), ev3('stage_completed', { stage: 'RECON' })]);
  const step = (kind: string, data: object, o: { actor?: string } = {}): string => { const e = ev3(kind, data, o); const r = apply(s, e); assert.ok(r.ok, r.reason); s = r.state; return e.id; };
  const sc = step('step_issued', { kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder' });
  step('step_claimed', { step_id: sc });
  step('step_verified', { step_id: sc, evidence: [] });
  step('gate_1_passed', { prompt_fact_id: 'f' }, { actor: 'human' });
  step('gate_2_passed', { prompt_fact_id: 'f', slices: [{ id: 'S1' }, { id: 'S2' }] }, { actor: 'human' });
  step('slice_started', { slice: 'S1' });
  return { get s() { return s; }, step };
}

test('step_cancelled (3-4) closes an open step and frees its role; a closed step cannot be cancelled; validateEvent requires step_id and reason', () => {
  const b = build34();
  const rv = b.step('step_issued', { kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'reviewer-code', slice: 'S1' });
  b.step('step_claimed', { step_id: rv });
  assert.equal(apply(b.s, ev3('step_issued', { kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'reviewer-code', slice: 'S1' })).ok, false, 'the role is busy');
  b.step('step_cancelled', { step_id: rv, reason: 'slice S1 is cut' });
  assert.equal(b.s.steps[rv].state, 'cancelled');
  assert.deepEqual(openSteps(b.s), []);
  assert.ok(apply(b.s, ev3('step_issued', { kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'reviewer-code', slice: 'S1' })).ok, 'the role is free again');
  assert.match(apply(b.s, ev3('step_cancelled', { step_id: rv, reason: 'again' })).reason!, /is cancelled/);
  assert.match(apply(b.s, ev3('step_reported', { step_id: rv })).reason!, /is cancelled/);
  const e = { v: 1, id: '01JQZZZZZZZZZZZZZZZZZZZ002', ts: '2026-10-24T10:00:00.000Z', run: 'r', kind: 'step_cancelled', actor: 'cli', corr: 'c' };
  assert.ok(validateEvent({ ...e, data: { step_id: rv, reason: 'voided' } }).ok);
  assert.deepEqual((validateEvent({ ...e, data: { step_id: rv } }) as { errors: string[] }).errors, ['step_cancelled.data.reason must be string']);
});

test('step_reissued with kind spawn (3-4) turns a resume into a spawn with no agent_id; without it the copy keeps its kind', () => {
  const b = build34();
  const r = b.step('step_issued', { kind: 'resume', stage: 'BUILD', attempt: 1, role: 'builder', agent_id: 'ag-1', slice: 'S1' });
  b.step('step_claimed', { step_id: r });
  b.step('step_reissued', { old: r, new: 'N1', kind: 'spawn' });
  assert.deepEqual([b.s.steps.N1.kind, 'agent_id' in b.s.steps.N1, b.s.steps.N1.attempt], ['spawn', false, 2]);
  b.step('step_claimed', { step_id: 'N1' });
  const r2 = b.step('step_reissued', { old: 'N1', new: 'N2' });
  assert.equal(b.s.steps.N2.kind, 'spawn');
  assert.ok(r2);
});

test('step_reissued with kind resume (6-4) continues the scaffolder\'s agent; its repair data is additive; resume without agent_id is rejected', () => {
  let st = fold([started3(), ev3('intake_confirmed', { prompt_fact_id: 'f' }, { actor: 'human' }), ev3('stage_completed', { stage: 'RECON' })]);
  const b = {
    get s() { return st; },
    step: (kind: string, data: object): string => { const e = ev3(kind, data); const r = apply(st, e); assert.ok(r.ok, r.reason); st = r.state; return e.id; },
  };
  assert.equal(b.s.phase, 'SCAFFOLD');
  const sc = b.step('step_issued', { kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder', agent: 'd2t-factory:scaffolder' });
  b.step('step_claimed', { step_id: sc, agent_id: 'ag-s' });
  b.step('step_reported', { step_id: sc, output: { status: 'DONE' } });
  assert.match(apply(b.s, ev3('step_reissued', { old: sc, new: 'R0', kind: 'resume' })).reason!, /resume requires agent_id/);
  b.step('step_reissued', { old: sc, new: 'R1', kind: 'resume', agent_id: 'ag-s', repair: { failures: ['contract.install failed (exit 1)'], checks: ['C1'] } });
  const r = b.s.steps.R1;
  assert.deepEqual([b.s.steps[sc].state, r.kind, r.agent_id, r.attempt, r.state, r.role, r.output], ['reissued', 'resume', 'ag-s', 2, 'issued', 'scaffolder', undefined]);
  // A reissue of the resume (its agent gone) is a spawn again.
  b.step('step_claimed', { step_id: 'R1' });
  b.step('step_reissued', { old: 'R1', new: 'R2', kind: 'spawn' });
  assert.deepEqual([b.s.steps.R2.kind, 'agent_id' in b.s.steps.R2], ['spawn', false]);
});

test('escalation_ruled moves the slice to slice_to, CUT included (3-4); stage_rerun_requested closes every open ask and clears the slices', () => {
  const b = build34();
  b.step('ask_raised', { card: { type: 'escalation', title: 'Over time box (S1)', reason_label: 'Over time box', commands: [] }, slice: 'S1', escalation: 'E1' });
  assert.equal(b.s.slices.S1.state, 'ESCALATED');
  b.step('escalation_ruled', { prompt_fact_id: 'f', escalation: 'E1', choice: 'cut', slice_to: 'CUT' }, { actor: 'human' });
  assert.deepEqual([b.s.slices.S1.state, b.s.cut_decided], ['CUT', false]);
  const c = build34();
  c.step('ask_raised', { card: { type: 'escalation', title: 'x', commands: [] }, slice: 'S1', escalation: 'E1' });
  c.step('ask_raised', { card: { type: 'cut', title: 'c', commands: [] } });
  c.step('stage_rerun_requested', { prompt_fact_id: 'f', stage: 'SLICE_PLAN', voids: ['V1'] }, { actor: 'human' });
  assert.deepEqual([c.s.phase, c.s.slice_order, Object.values(c.s.asks).map((a) => a.open), c.s.voided], ['SLICE_PLAN', [], [false, false], ['V1']]);
  assert.match(apply(c.s, ev3('stage_rerun_requested', { prompt_fact_id: 'f', stage: 'WRAP', voids: [] }, { actor: 'human' })).reason!, /WRAP cannot be rerun/);
});

test('stage_started.readonly_paths (8-1) is copied onto the state only when present', () => {
  const [started] = load('happy-path');
  const st = (data: object): AnyEvent => ({ ...started, id: '01JQZZZZZZZZZZZZZZZZZZZ999', kind: 'stage_started', data } as unknown as AnyEvent);
  const withRo = fold([started, st({ stage: 'SCAFFOLD', port: 4000, worktree: '/w', readonly_paths: ['.mcp.json'] })]);
  assert.deepEqual([withRo.worktree, withRo.readonly_paths], ['/w', ['.mcp.json']]);
  assert.ok(validateEvent(st({ stage: 'SCAFFOLD', readonly_paths: ['.mcp.json'] })).ok);
  assert.equal('readonly_paths' in fold([started, st({ stage: 'SCAFFOLD', port: 4000, worktree: '/w' })]), false);
});
