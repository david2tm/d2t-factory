// core/projection.ts on the reducer fixtures: columns, claim chips, seals, voids, Needs You, deadlines.
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLAIM_OVERDUE_MS, HEARTBEAT_INTERVAL_MS, SIGNAL_LOST_MISSED } from '../src/core/config.ts';
import type { AnyEvent } from '../src/core/events.ts';
import { projectBoard, projectRun, type Lane, type RunInput } from '../src/core/projection.ts';
import { fold } from '../src/core/reducer.ts';
import { readLines } from '../src/store/jsonl.ts';

const FIX = join(import.meta.dirname, 'fixtures');
const load = (name: string): AnyEvent[] => readLines<AnyEvent>(join(FIX, `${name}.jsonl`)).items;
const RUN = 'add-login-page-q7k2';
const SESSION = '11111111-2222-4333-8444-555555555555';

const input = (commands: AnyEvent[], facts: AnyEvent[] = [], skipped: unknown[] = []): RunInput => ({ state: fold(commands), commands, facts, skipped });
const lane = (commands: AnyEvent[], facts: AnyEvent[] = []): Lane => projectRun(input(commands, facts), { repo_hash: 'abc123def456', run_id: RUN });
const card = (l: Lane, id: string) => { const c = l.cards.find((x) => x.id === id); assert.ok(c, `no card ${id} in ${l.cards.map((x) => x.id).join(', ')}`); return c; };
const kindOf = (l: Lane, id: string): string => l.decisions.find((d) => d.id === id)!.kind;
const plus = (ts: string, ms: number): string => new Date(Date.parse(ts) + ms).toISOString();

let n = 0;
const ev = (kind: string, data: object, o: { ts?: string; actor?: string; session?: string } = {}): AnyEvent =>
  ({ v: 1, id: `01JQZZZZZZZZZZZZZZZZZZZ${String(++n).padStart(3, '0')}`, ts: o.ts ?? '2026-10-24T10:00:00.000Z', run: RUN, kind, actor: o.actor ?? 'cli', corr: 'c', ...(o.session ? { session: o.session } : {}), data }) as unknown as AnyEvent;
const human = (kind: string, data: object = {}, ts?: string): AnyEvent => ev(kind, { prompt_fact_id: 'f', ...data }, { actor: 'human', session: SESSION, ts });
const upTo = (events: AnyEvent[], pred: (e: AnyEvent) => boolean): AnyEvent[] => events.slice(0, events.findIndex(pred));

test('happy path: every stage and slice card is done, every claim verified, and each human decision is one seal', () => {
  const l = lane(load('happy-path'));
  assert.deepEqual([l.phase, l.stage, l.terminal, l.parked, l.origin, l.task], ['COMPLETED', 'WRAP', true, false, 'brownfield', 'add login page']);
  assert.deepEqual(l.cards.map((c) => [c.id, c.column]), [
    ['stage:INTAKE', 'done'], ['stage:RECON', 'done'], ['stage:SCAFFOLD', 'done'], ['stage:SPEC', 'done'], ['stage:SLICE_PLAN', 'done'], ['stage:WRAP', 'done'], ['slice:S1', 'done'],
  ]);
  const claims = l.cards.flatMap((c) => c.claims);
  assert.ok(claims.length >= 6);
  assert.ok(claims.every((c) => c.state === 'verified' && !c.superseded), JSON.stringify(claims));
  assert.deepEqual(card(l, 'slice:S1').claims.map((c) => [c.role, c.verdict ?? null]), [['builder', null], ['reviewer-code', 'APPROVE']]);
  // Each decision seals exactly one card: intake, gate 1, gate 2, merge.
  const seals = l.cards.flatMap((c) => c.seals.map((id) => [c.id, kindOf(l, id)]));
  assert.deepEqual(seals, [['stage:INTAKE', 'intake_confirmed'], ['stage:SPEC', 'gate_1_passed'], ['stage:SLICE_PLAN', 'gate_2_passed'], ['stage:WRAP', 'merge_approved']]);
  assert.deepEqual(l.decisions.map((d) => [d.kind, d.stage, d.decided_by, d.superseded]), [
    ['intake_confirmed', 'INTAKE', 'human', false], ['gate_1_passed', 'SPEC', 'human', false], ['gate_2_passed', 'SLICE_PLAN', 'human', false], ['merge_approved', 'WRAP', 'human', false],
  ]);
  assert.deepEqual(l.stage_track.map((x) => x.status), ['done', 'done', 'done', 'done', 'done', 'done', 'done']);
  assert.deepEqual(l.gates, [{ n: 1, status: 'passed' }, { n: 2, status: 'passed' }]);
  assert.deepEqual(l.deadlines, { signal_lost_at: null, overdue_at: null, cut_at: null, ends_at: null, timebox_ends_at: null });
  assert.deepEqual(l.needs_you, []);
  assert.equal(l.started_at, load('happy-path')[0].ts);
  assert.equal(l.live, undefined, 'the live overlay is the server\'s, never the projection\'s');
});

test('the projection is pure: the same input gives the same JSON, with no clock in it', () => {
  const events = load('findings-escalation-rework');
  const a = JSON.stringify(lane(events));
  assert.equal(JSON.stringify(lane(events)), a);
  assert.deepEqual(JSON.parse(a), lane(events));
});

test('claim chips (AD-7): reported → claimed with overdue_at = report + CLAIM_OVERDUE_MS; step_verified → verified with its evidence rows', () => {
  const all = load('happy-path');
  const builder = all.find((e) => e.kind === 'step_issued' && (e.data as { role?: string }).role === 'builder')!;
  const reported = all.find((e) => e.kind === 'step_reported' && (e.data as { step_id: string }).step_id === builder.id)!;
  const before = upTo(all, (e) => e.kind === 'step_verified' && (e.data as { step_id: string }).step_id === builder.id);
  const l1 = lane(before);
  const c1 = card(l1, 'slice:S1').claims;
  assert.deepEqual(c1, [{ step_id: builder.id, role: 'builder', kind: 'spawn', state: 'claimed', reported_at: reported.ts, overdue_at: plus(reported.ts, CLAIM_OVERDUE_MS), waiting_on: null, waiting_for: null, superseded: false, evidence: [] }]);
  assert.equal(l1.deadlines.overdue_at, plus(reported.ts, CLAIM_OVERDUE_MS));
  assert.equal(l1.deadlines.signal_lost_at, plus(reported.ts, HEARTBEAT_INTERVAL_MS * SIGNAL_LOST_MISSED));
  assert.equal(card(l1, 'slice:S1').column, 'in_progress');

  // With its step_verified, and the facts it names: ids, kinds and paths only.
  const facts = [
    ev('output_written', { path: '/x/artifacts/steps/builder/out.md', agent_id: 'agent-builder', first_line: 'STATUS: DONE secret text' }, { actor: 'hook', session: SESSION }),
    ev('subagent_stopped', { agent_id: 'agent-builder' }, { actor: 'hook', session: SESSION }),
  ];
  (facts[0] as { id: string }).id = 'fact-output';
  (facts[1] as { id: string }).id = 'fact-stop';
  const l2 = lane(all, facts);
  const c2 = card(l2, 'slice:S1').claims[0];
  assert.equal(c2.state, 'verified');
  assert.deepEqual(c2.evidence, [
    { id: 'fact-stop', kind: 'subagent_stopped', ts: facts[1].ts },
    { id: 'fact-output', kind: 'output_written', ts: facts[0].ts, path: '/x/artifacts/steps/builder/out.md' },
  ]);
  assert.ok(!JSON.stringify(l2).includes('secret text'), 'no fact text reaches the board');
  // Evidence that is not an event (a cwd proof) is a bare reference.
  assert.deepEqual(lane(all).cards.find((c) => c.id === 'slice:S1')!.claims[0].evidence.map((r) => r.kind), ['ref', 'ref']);
});

test('voided and reissued claims are superseded; a rework seals the cards it sends back', () => {
  const all = load('happy-path');
  const spec = all.find((e) => e.kind === 'step_issued' && (e.data as { role?: string }).role === 'spec-writer')!;
  const events = [...upTo(all, (e) => e.kind === 'gate_1_passed'), human('rework_requested', { target: 'gate1', note: 'tighten AC-2', voids: [spec.id] })];
  const l = lane(events);
  const sc = card(l, 'stage:SPEC');
  assert.deepEqual(sc.claims.map((c) => [c.role, c.state, c.superseded]), [['spec-writer', 'claimed', true]]);
  assert.deepEqual(sc.seals.map((id) => kindOf(l, id)), ['rework_requested']);
  assert.equal(sc.column, 'in_progress');
  assert.equal(l.deadlines.overdue_at, null, 'a superseded claim is never overdue');
  assert.deepEqual(l.gates[0], { n: 1, status: 'hollow' });

  // The fixture's reissued builder resume, its escalation ruling, the cut and the slice rework.
  const f = lane(load('findings-escalation-rework'));
  const s1 = card(f, 'slice:S1');
  assert.deepEqual([s1.column, s1.state, s1.rounds], ['in_progress', 'BUILDING', 1]);
  assert.deepEqual(s1.claims.map((c) => [c.role, c.state, c.superseded]), [
    ['builder', 'verified', false], ['reviewer-code', 'verified', false], ['builder', 'claimed', true], ['builder', 'verified', false],
  ]);
  assert.equal(s1.claims[1].verdict, 'FINDINGS');
  assert.deepEqual(s1.seals.map((id) => kindOf(f, id)), ['escalation_ruled', 'rework_requested']);
  const s2 = card(f, 'slice:S2');
  assert.deepEqual([s2.column, s2.state, s2.seals.map((id) => kindOf(f, id))], ['done', 'CUT', ['cut_decided']]);
  const ruled = f.decisions.find((d) => d.kind === 'escalation_ruled')!;
  assert.deepEqual([ruled.stage, ruled.reason], ['BUILD', 'Builder stuck on S1']);
  // Seals never repeat: one card per decision here.
  const sealed = f.cards.flatMap((c) => c.seals);
  assert.equal(new Set(sealed).size, sealed.length);
  assert.deepEqual([...sealed].sort(), f.decisions.map((d) => d.id).sort());
});

test('Needs You: an open gate parks the run in the stage card\'s needs_you column; an escalation moves its slice there', () => {
  const all = load('happy-path');
  const card1 = { type: 'gate_1', title: 'Gate 1 — approve the spec', reason_label: 'Spec', reason: 'spec.md · 1 assumption to check', commands: ['/factory approve gate1', '/factory rework gate1 <note…>'] };
  const gate = ev('step_issued', { kind: 'ask_human', stage: 'SPEC', attempt: 1, card: card1 }, { ts: '2026-10-24T09:30:00.000Z' });
  const l = lane([...upTo(all, (e) => e.kind === 'gate_1_passed'), gate]);
  assert.equal(l.parked, true);
  assert.deepEqual(l.needs_you, [{ ask_id: gate.id, raised_at: gate.ts, card: card1 }]);
  assert.equal(card(l, 'stage:SPEC').column, 'needs_you');
  assert.equal(l.stage_track.find((x) => x.stage === 'SPEC')!.status, 'waiting');
  assert.deepEqual(l.gates, [{ n: 1, status: 'waiting' }, { n: 2, status: 'hollow' }]);
  assert.equal(l.deadlines.signal_lost_at, null, 'a parked run cannot lose its signal');

  const f = load('findings-escalation-rework');
  const esc = lane(upTo(f, (e) => e.kind === 'escalation_ruled'));
  const raised = f.find((e) => e.kind === 'ask_raised')!;
  assert.deepEqual(esc.needs_you, [{ ask_id: raised.id, raised_at: raised.ts, slice: 'S1', card: (raised.data as { card: unknown }).card }]);
  assert.equal(card(esc, 'slice:S1').column, 'needs_you');
});

test('the design question: its ask_human card (stage DESIGN) lands in Needs You, beside an in-flight SPEC; the DESIGN card waits there with the designer\'s claim', () => {
  const all = load('happy-path');
  const pre = upTo(all, (e) => e.kind === 'step_issued' && (e.data as { role?: string }).role === 'spec-writer');
  const sw = ev('step_issued', { kind: 'spawn', stage: 'SPEC', attempt: 1, role: 'spec-writer', agent: 'd2t-factory:spec-writer' });
  const d = ev('step_issued', { kind: 'spawn', stage: 'DESIGN', attempt: 1, role: 'designer', agent: 'd2t-factory:designer' });
  const done = [ev('step_claimed', { step_id: d.id }), ev('step_reported', { step_id: d.id, output: { status: 'DONE' } }), ev('step_verified', { step_id: d.id, evidence: [] })];
  const q = { type: 'design_choice', title: 'Design question — Light or dark?', reason_label: 'Design', reason: 'a: Light · b: Dark · default a', commands: ['/factory choose a', '/factory choose b'] };
  const ask = ev('step_issued', { kind: 'ask_human', stage: 'DESIGN', attempt: 1, card: q }, { ts: '2026-10-24T09:40:00.000Z' });
  const l = lane([...pre, sw, d, ...done, ask]);
  assert.deepEqual(l.needs_you, [{ ask_id: ask.id, raised_at: ask.ts, card: q }]);
  assert.equal(card(l, 'stage:DESIGN').column, 'needs_you');
  assert.deepEqual(card(l, 'stage:DESIGN').claims.map((c) => [c.role, c.state]), [['designer', 'verified']]);
  assert.ok(l.stage_track.some((x) => x.stage === 'DESIGN'));
});

test('an abandoned run is terminal; the board lists started runs newest first; skipped lines are counted', () => {
  const ab = lane(load('illegal-then-abandon'));
  assert.deepEqual([ab.phase, ab.stage, ab.terminal, card(ab, 'stage:RECON').state], ['ABANDONED', 'RECON', true, 'abandoned']);
  assert.deepEqual(card(ab, 'stage:RECON').seals.map((id) => kindOf(ab, id)), ['run_abandoned']);

  const events = load('happy-path');
  const older = projectRun(input(events, [], [{}, {}]), { repo_hash: 'aaa', run_id: 'old' });
  assert.equal(older.skipped, 2);
  const newer = projectRun(input(events.map((e, i) => (i === 0 ? { ...e, ts: '2026-10-25T00:00:00.000Z' } : e)) as AnyEvent[]), { repo_hash: 'bbb', run_id: 'new' });
  const empty = projectRun(input([]), { repo_hash: 'ccc', run_id: 'empty' });
  assert.deepEqual(projectBoard([older, empty, newer]).runs.map((r) => r.run_id), ['new', 'old']);
});

test('seal rules: greenfield rerun of RECON seals FRAME; a keep seals the Backlog slices; DESIGN takes design and gate 1 seals; an abandon in BUILD seals the active slice; a stage-level ruling seals its step\'s stage', () => {
  const all = load('happy-path');
  const preGate1 = upTo(all, (e) => e.kind === 'gate_1_passed');
  const sealKinds = (l: Lane, id: string): string[] => card(l, id).seals.map((d) => kindOf(l, d));

  // Greenfield: the orient stage is FRAME, and a rerun of RECON lands on it.
  const green = preGate1.map((e, i) => (i === 0 ? { ...e, data: { ...(e.data as object), greenfield: true } } : e)) as AnyEvent[];
  const g = lane([...green, human('stage_rerun_requested', { stage: 'RECON', voids: [] })]);
  assert.equal(g.origin, 'greenfield');
  assert.deepEqual(sealKinds(g, 'stage:FRAME'), ['stage_rerun_requested']);
  assert.ok(!g.cards.some((c) => c.id === 'stage:RECON'));

  // A keep (nothing cut) seals each slice it kept in Backlog.
  const f = load('findings-escalation-rework');
  const k = lane([...upTo(f, (e) => e.kind === 'slice_started'), human('cut_decided', { cut: [] })]);
  assert.deepEqual([sealKinds(k, 'slice:S1'), sealKinds(k, 'slice:S2')], [['cut_decided'], ['cut_decided']]);

  // Once a DESIGN step exists, DESIGN takes the design choice and gate 1 (beside SPEC).
  const designer = ev('step_issued', { kind: 'spawn', stage: 'DESIGN', attempt: 1, role: 'designer', agent: 'd2t-factory:designer' });
  const d = lane([...preGate1, designer, human('design_choice_made', { choice: 'a' }), human('gate_1_passed')]);
  assert.deepEqual(sealKinds(d, 'stage:DESIGN'), ['design_choice_made', 'gate_1_passed']);
  assert.deepEqual(sealKinds(d, 'stage:SPEC'), ['gate_1_passed']);
  assert.ok(d.stage_track.some((x) => x.stage === 'DESIGN'));

  // An abandon during BUILD seals the active slice.
  const firstBuilder = f.findIndex((e) => e.kind === 'step_issued' && (e.data as { role?: string }).role === 'builder');
  const ab = lane([...f.slice(0, firstBuilder), human('run_abandoned')]);
  assert.deepEqual([ab.phase, sealKinds(ab, 'slice:S1')], ['ABANDONED', ['run_abandoned']]);

  // A ruling on an ask with no slice seals the stage card of the ask's step.
  const scaffolder = all.find((e) => e.kind === 'step_issued' && (e.data as { role?: string }).role === 'scaffolder')!;
  const ask = ev('ask_raised', { card: { type: 'scaffold_failure', title: 'SCAFFOLD failed', reason_label: 'Scaffold failed', reason: 'health failed', commands: [] }, step_id: scaffolder.id, escalation: 'E1' });
  const before = lane([...preGate1, ask]);
  assert.equal(card(before, 'stage:SCAFFOLD').column, 'done', 'a done stage card stays done');
  assert.deepEqual(before.needs_you.map((x) => x.ask_id), [ask.id]);
  const r = lane([...preGate1, ask, human('escalation_ruled', { escalation: 'E1', choice: 'accept' })]);
  assert.deepEqual(sealKinds(r, 'stage:SCAFFOLD'), ['escalation_ruled']);
  assert.equal(r.decisions.at(-1)!.reason, 'Scaffold failed: health failed');
});

test('an event ts that matches the format but is no real date (month 13) gives a null deadline, not a throw', () => {
  const events = load('findings-escalation-rework');
  const bad = [...events, ev('stage_started', { stage: 'BUILD' }, { ts: '2026-13-01T00:00:00.000Z' })];
  const l = lane(bad);
  assert.equal(l.last_event_at, '2026-13-01T00:00:00.000Z');
  assert.equal(l.deadlines.signal_lost_at, null);
});

// --- 3-1: the budget clock and the cut card ---------------------------------------------------------

test('budget: null (and no cut or end deadline) without an intake; with one, the clock and its deadlines; an open cut card puts every Backlog slice AT RISK and shows once in Needs You; a terminal clock stops', () => {
  assert.deepEqual([lane(load('happy-path')).budget, lane(load('happy-path')).deadlines.cut_at, lane(load('happy-path')).deadlines.ends_at], [null, null, null]);
  const clock = '2026-10-24T08:00:00.000Z';
  const intake = { limit_min: 120, slice_timebox_min: 30, ui_free: false, reviewer_overrides: { add: [], remove: [] } };
  const sc = ev('step_issued', { kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder' });
  const events: AnyEvent[] = [
    ev('run_started', { task: 't', repo_hash: 'h', base_sha: 'b', branch: 'f' }),
    human('intake_confirmed', { intake, clock_start: clock }),
    ev('stage_completed', { stage: 'RECON' }),
    sc, ev('step_claimed', { step_id: sc.id }, { session: SESSION }), ev('step_verified', { step_id: sc.id, evidence: [] }),
    human('gate_1_passed'), human('gate_2_passed', { slices: [{ id: 'S1', title: 'one' }, { id: 'S2', title: 'two' }, { id: 'S3', title: 'three' }] }),
    ev('slice_started', { slice: 'S1' }),
  ];
  const before = lane(events);
  const budget = { clock_start: clock, limit_min: 120, cut_at: '2026-10-24T09:20:00.000Z', ends_at: '2026-10-24T10:00:00.000Z', stopped_at: null };
  assert.deepEqual(before.budget, budget);
  assert.deepEqual([before.deadlines.cut_at, before.deadlines.ends_at], [budget.cut_at, budget.ends_at]);
  assert.ok(before.cards.every((c) => !('at_risk' in c)), 'no cut card: nothing at risk');

  const cutCard = { type: 'cut', title: 'Cut point reached — 2 slices unbuilt. Cut S2, S3?', commands: ['/factory cut S2,S3', '/factory keep'] };
  const raised = ev('ask_raised', { card: cutCard }, { ts: '2026-10-24T09:20:01.000Z' });
  const step = ev('step_issued', { kind: 'ask_human', stage: 'BUILD', attempt: 1, card: cutCard });
  const open = lane([...events, raised, step, ev('step_claimed', { step_id: step.id }, { session: SESSION })]);
  assert.deepEqual(open.cards.filter((c) => c.kind === 'slice').map((c) => [c.id, c.column, c.at_risk ?? false]), [['slice:S1', 'in_progress', false], ['slice:S2', 'backlog', true], ['slice:S3', 'backlog', true]]);
  assert.deepEqual(open.needs_you, [{ ask_id: raised.id, raised_at: '2026-10-24T09:20:01.000Z', card: cutCard }], 'the ask, not its ask_human step too');

  const cut = human('cut_decided', { cut: ['S3'] });
  const kept = lane([...events, raised, step, cut, ev('step_verified', { step_id: step.id, evidence: [] })]);
  assert.deepEqual(kept.cards.filter((c) => c.kind === 'slice').map((c) => [c.id, c.state, c.at_risk ?? false]), [['slice:S1', 'BUILDING', false], ['slice:S2', 'BACKLOG', false], ['slice:S3', 'CUT', false]]);
  assert.deepEqual(kept.needs_you, []);
  assert.deepEqual(card(kept, 'slice:S3').seals, [cut.id]);

  const ended = lane([...events, human('run_abandoned', {}, '2026-10-24T11:00:00.000Z')]);
  assert.deepEqual(ended.budget, { ...budget, stopped_at: '2026-10-24T11:00:00.000Z' });
  assert.deepEqual([ended.deadlines.cut_at, ended.deadlines.ends_at], [null, null]);
});

test('no time limit (6-2): the budget carries only clock_start, with no cut or end deadline, past any cut point; a terminal clock stops', () => {
  const clock = '2026-10-24T08:00:00.000Z';
  const intake = { task: 't', scope: { in: [], out: [] }, slice_timebox_min: 30, ui_free: false, reviewer_overrides: { add: [], remove: [] } };
  const events: AnyEvent[] = [
    ev('run_started', { task: 't', repo_hash: 'h', base_sha: 'b', branch: 'f' }),
    human('intake_confirmed', { intake, clock_start: clock }),
    ev('stage_completed', { stage: 'RECON' }),
  ];
  const l = lane(events);
  assert.deepEqual(l.budget, { clock_start: clock, limit_min: null, cut_at: null, ends_at: null, stopped_at: null });
  assert.deepEqual(Object.keys(l.budget!), ['clock_start', 'limit_min', 'cut_at', 'ends_at', 'stopped_at'], 'the same keys, in the same order, as with a limit');
  assert.deepEqual([l.deadlines.cut_at, l.deadlines.ends_at], [null, null]);
  const ended = lane([...events, human('run_abandoned', {}, '2026-10-24T11:00:00.000Z')]);
  assert.deepEqual(ended.budget, { clock_start: clock, limit_min: null, cut_at: null, ends_at: null, stopped_at: '2026-10-24T11:00:00.000Z' });
});

test('time box (3-4): a live slice card carries timebox_ends_at and timebox_min, the lane its earliest end; an escalation pauses it (none shown), a closed or Backlog slice has none; no intake, no time box', () => {
  const intake = { limit_min: 120, slice_timebox_min: 30, ui_free: false, reviewer_overrides: { add: [], remove: [] } };
  const sc = ev('step_issued', { kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder' });
  const events: AnyEvent[] = [
    ev('run_started', { task: 't', repo_hash: 'h', base_sha: 'b', branch: 'f' }),
    human('intake_confirmed', { intake, clock_start: '2026-10-24T09:00:00.000Z' }),
    ev('stage_completed', { stage: 'RECON' }),
    sc, ev('step_claimed', { step_id: sc.id }, { session: SESSION }), ev('step_verified', { step_id: sc.id, evidence: [] }),
    human('gate_1_passed'), human('gate_2_passed', { slices: [{ id: 'S1', title: 'one' }, { id: 'S2', title: 'two' }, { id: 'S3', title: 'three' }] }),
    ev('slice_started', { slice: 'S1' }, { ts: '2026-10-24T10:00:00.000Z' }),
    ev('slice_started', { slice: 'S2' }, { ts: '2026-10-24T10:05:00.000Z' }),
  ];
  const l = lane(events);
  const slices = (x: Lane) => x.cards.filter((c) => c.kind === 'slice').map((c) => [c.id, c.timebox_ends_at, c.timebox_min]);
  assert.deepEqual(slices(l), [['slice:S1', '2026-10-24T10:30:00.000Z', 30], ['slice:S2', '2026-10-24T10:35:00.000Z', 30], ['slice:S3', undefined, undefined]]);
  assert.equal(l.deadlines.timebox_ends_at, '2026-10-24T10:30:00.000Z');
  const card = { type: 'escalation', title: 'Over time box (S1)', reason_label: 'Over time box', reason: 'S1 at 30 / 30 min.', commands: [], condition: 3 };
  const esc = lane([...events, ev('ask_raised', { card, slice: 'S1', escalation: 'E1' }, { ts: '2026-10-24T10:30:00.000Z' })]);
  assert.deepEqual(slices(esc).slice(0, 2), [['slice:S1', undefined, undefined], ['slice:S2', '2026-10-24T10:35:00.000Z', 30]]);
  assert.equal(esc.needs_you[0].card.condition, 3);
  const ruled = lane([...events, ev('ask_raised', { card, slice: 'S1', escalation: 'E1' }, { ts: '2026-10-24T10:30:00.000Z' }), human('escalation_ruled', { escalation: 'E1', choice: 'retry more', slice_to: 'BUILDING' }, '2026-10-24T10:40:00.000Z')]);
  assert.deepEqual(slices(ruled)[0], ['slice:S1', '2026-10-24T11:10:00.000Z', 60], 'a second box, the 10 escalated minutes not counted');
  assert.equal(lane(load('happy-path')).deadlines.timebox_ends_at, null);
  assert.ok(lane(load('findings-escalation-rework')).cards.every((c) => !('timebox_min' in c)), 'no intake: no time box');
});

test('an abandon in BUILD (3-4) seals every live slice: S1 and S2 started, S3 in Backlog unsealed', () => {
  const sc = ev('step_issued', { kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder' });
  const ab = human('run_abandoned');
  const l = lane([
    ev('run_started', { task: 't', repo_hash: 'h', base_sha: 'b', branch: 'f' }), human('intake_confirmed'), ev('stage_completed', { stage: 'RECON' }),
    sc, ev('step_claimed', { step_id: sc.id }, { session: SESSION }), ev('step_verified', { step_id: sc.id, evidence: [] }),
    human('gate_1_passed'), human('gate_2_passed', { slices: [{ id: 'S1' }, { id: 'S2' }, { id: 'S3' }] }),
    ev('slice_started', { slice: 'S1' }), ev('slice_started', { slice: 'S2' }), ab,
  ]);
  assert.deepEqual(l.cards.filter((c) => c.kind === 'slice').map((c) => [c.id, c.seals]), [['slice:S1', [ab.id]], ['slice:S2', [ab.id]], ['slice:S3', []]]);
});

test('PAUSED (6-1): the newest stop fact shows until a later command or main-agent tool fact of its session; subagent and other-session facts keep it; terminal runs and runs without stop facts have none', () => {
  const all = load('happy-path');
  const commands = upTo(all, (e) => e.kind === 'step_verified');
  const last = commands.at(-1)!.ts;
  const fact = (kind: string, data: object, ms: number, session = SESSION): AnyEvent => ev(kind, data, { ts: plus(last, ms), actor: 'hook', session });
  const yielded = fact('stop_yielded', { reason: 'human_rejected', tool_use_id: 'toolu_1' }, 1000);
  const forced = fact('stop_forced', { blocks: 3, reason: 'step S is issued' }, 2000);
  assert.deepEqual(lane(commands, [yielded]).paused, { reason: 'human_rejected', at: yielded.ts });
  assert.deepEqual(lane(commands, [yielded, forced]).paused, { reason: 'block_cap', at: forced.ts, blocks: 3 });
  // Kept by a subagent's tool fact, by another session's, and by non-tool facts.
  const kept = [
    fact('tool_succeeded', { tool_name: 'Bash', agent_id: 'a1' }, 3000),
    fact('tool_succeeded', { tool_name: 'Bash' }, 3000, 'other-session'),
    fact('subagent_stopped', { agent_id: 'a1' }, 3000),
  ];
  assert.equal(lane(commands, [forced, ...kept]).paused?.reason, 'block_cap');
  // Cleared by the conductor's next tool call, command or written output.
  assert.equal(lane(commands, [forced, fact('tool_succeeded', { tool_name: 'Bash' }, 3000)]).paused, undefined);
  assert.equal(lane(commands, [forced, fact('tool_failed', { tool_name: 'Bash', exit_code: 1 }, 3000)]).paused, undefined);
  assert.equal(lane(commands, [forced, fact('output_written', { path: '/x' }, 3000)]).paused, undefined);
  assert.equal(lane(all.slice(0, commands.length + 1).map((e, i) => (i === commands.length ? { ...e, ts: plus(last, 3000) } : e)), [forced]).paused, undefined);
  // A tool fact older than the stop doesn't clear it.
  assert.equal(lane(commands, [fact('tool_succeeded', { tool_name: 'Bash' }, 500), yielded]).paused?.reason, 'human_rejected');
  // Terminal: no notice. No stop facts: no key at all, so recordings project as before.
  assert.equal(lane(all, [fact('stop_forced', { blocks: 3, reason: 'r' }, Date.parse(all.at(-1)!.ts) - Date.parse(last) + 1000)]).paused, undefined);
  for (const name of ['happy-path', 'findings-escalation-rework', 'illegal-then-abandon']) {
    const events = load(name);
    for (let i = 1; i <= events.length; i++) assert.equal('paused' in lane(events.slice(0, i)), false, `${name} @${i}`);
  }
});

// 6-3 (AD-23): the happy path with the spec's step_verified embedding its artifact and gate 1 pinning it.
function withSpecArtifact(all: AnyEvent[]) {
  const spec = all.find((e) => e.kind === 'step_issued' && (e.data as { role?: string }).role === 'spec-writer')!;
  const verified = all.find((e) => e.kind === 'step_verified' && (e.data as { step_id: string }).step_id === spec.id)!;
  const gate1 = all.find((e) => e.kind === 'gate_1_passed')!;
  const artifact = { path: '/h/steps/spec/out.md', sha256: 's1', body: 'STATUS: DONE\n# Footer [REDACTED]\n', truncated: false };
  const events = all.map((e) => (e.id === verified.id ? { ...e, data: { ...e.data, artifact } } : e.id === gate1.id ? { ...e, data: { ...e.data, pins: [{ path: artifact.path, sha256: 's1' }] } } : e)) as AnyEvent[];
  return { events, spec, verified, gate1, artifact };
}

test('artifacts (6-3): an embedding step_verified is one artifact on the lane, pinned_by the decision whose pins hold its bytes; old events project as before', () => {
  const all = load('happy-path');
  const { events, spec, verified, gate1, artifact } = withSpecArtifact(all);
  const l = lane(events);
  assert.deepEqual(l.artifacts, [{
    id: verified.id, step_id: spec.id, stage: 'SPEC', name: 'spec.md', path: artifact.path, sha256: 's1', body: artifact.body, truncated: false, superseded: false, pinned_by: gate1.id,
  }]);
  assert.equal('artifacts' in lane(all), false, 'no embed, no artifacts key');
  // Before gate 1 the artifact is not yet approved, and the open gate_1 card names it as a file.
  const card1 = { type: 'gate_1', title: 'Gate 1 — approve the spec', commands: ['/factory approve gate1'] };
  const gate = ev('step_issued', { kind: 'ask_human', stage: 'SPEC', attempt: 1, card: card1 });
  const open = lane([...upTo(events, (e) => e.id === gate1.id), gate]);
  assert.equal(open.artifacts![0].pinned_by, null);
  assert.deepEqual(open.needs_you, [{ ask_id: gate.id, raised_at: gate.ts, card: card1, files: [verified.id] }]);
  // Other cards carry no files.
  assert.ok(lane(load('findings-escalation-rework')).needs_you.every((n) => !('files' in n)));
});

test('artifacts (6-3): a Gate 1 rework supersedes the old spec; the new one is not pinned until gate 1 passes again, and the card then names only it', () => {
  const { events, spec, verified, gate1 } = withSpecArtifact(load('happy-path'));
  const before = upTo(events, (e) => e.id === gate1.id);
  const rework = human('rework_requested', { target: 'gate1', note: 'grey footer', voids: [spec.id, verified.id] });
  const sw2 = ev('step_issued', { kind: 'spawn', stage: 'SPEC', attempt: 2, role: 'spec-writer', output_path: '/h/steps/spec2/out.md' });
  const art2 = { path: '/h/steps/spec2/out.md', sha256: 's2', body: '# Grey footer\n', truncated: false };
  const v2 = ev('step_verified', { step_id: sw2.id, evidence: [], artifact: art2 });
  const respec = [rework, sw2, ev('step_claimed', { step_id: sw2.id }, { session: SESSION }), ev('step_reported', { step_id: sw2.id, output: { status: 'DONE', sha256: 's2' } }, { session: SESSION }), v2];
  const card1 = { type: 'gate_1', title: 'Gate 1 — approve the spec', commands: ['/factory approve gate1'] };
  const gate = ev('step_issued', { kind: 'ask_human', stage: 'SPEC', attempt: 1, card: card1 });
  const l = lane([...before, ...respec, gate]);
  assert.deepEqual(l.artifacts!.map((a) => [a.id, a.superseded, a.pinned_by]), [[verified.id, true, null], [v2.id, false, null]]);
  assert.deepEqual(l.needs_you.map((n) => n.files), [[v2.id]]);
  const passed = human('gate_1_passed', { pins: [{ path: art2.path, sha256: 's2' }] });
  const l2 = lane([...before, ...respec, gate, passed]);
  assert.deepEqual(l2.artifacts!.map((a) => [a.superseded, a.pinned_by]), [[true, null], [false, passed.id]]);
});

test('claims (6-3): a scaffolder waiting on its checks stays CLAIMED with no overdue_at, and sets no lane overdue deadline', () => {
  const all = load('happy-path');
  const sc = all.find((e) => e.kind === 'step_issued' && (e.data as { role?: string }).role === 'scaffolder')!;
  // The fixture's reports embed no output: the scaffolder's says DONE here.
  const events = upTo(all, (e) => e.kind === 'step_verified' && (e.data as { step_id: string }).step_id === sc.id)
    .map((e) => (e.kind === 'step_reported' && e.data.step_id === sc.id ? { ...e, data: { ...e.data, output: { status: 'DONE' } } } : e)) as AnyEvent[];
  const l = lane(events);
  const claim = card(l, 'stage:SCAFFOLD').claims.find((c) => c.step_id === sc.id)!;
  assert.deepEqual([claim.state, claim.waiting_on, claim.waiting_for, claim.overdue_at], ['claimed', 'checks', 'install, health, test', null]);
  assert.equal(l.deadlines.overdue_at, null, 'a claim waiting on checks never goes overdue');
});
