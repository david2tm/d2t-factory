import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cutCard, designChoiceCard, gate1Card, intakeCard, intakeConfirmCard } from '../src/core/cards.ts';
import type { AnyEvent } from '../src/core/events.ts';
import { apply, fold, initialState, type RunState } from '../src/core/reducer.ts';
import { due, type WrapProbe } from '../src/core/schedule.ts';
import { nextBacklog, rerunVoids } from '../src/core/verify.ts';

const started = (): RunState => fold([{ v: 1, id: 'A', ts: 't', run: 'r', kind: 'run_started', actor: 'cli', corr: '', data: { task: 't', repo_hash: 'h', base_sha: 's', branch: 'b' } } as any]);

// A tiny event writer: each call applies one command to the state.
function writer() {
  let n = 0;
  let s = started();
  const log: AnyEvent[] = [];
  const put = (kind: string, data: object, extra: object = {}): string => {
    const id = `E${++n}`;
    const e = { v: 1, id, ts: 't', run: 'r', kind, actor: 'cli', corr: '', session: 'S', data, ...extra } as AnyEvent;
    const r = apply(s, e);
    assert.ok(r.ok, `${kind}: ${r.reason}`);
    s = r.state;
    log.push(e);
    return id;
  };
  const issue = (d: object): string => put('step_issued', d);
  const finish = (id: string, output?: object): void => {
    put('step_claimed', { step_id: id });
    put('step_reported', { step_id: id, ...(output ? { output } : {}) });
    put('step_verified', { step_id: id, evidence: [] });
  };
  return { put, issue, finish, get s() { return s; }, log };
}

const IN = { in_worktree: true, recon_cached: false };
const OUT = { in_worktree: false, recon_cached: false };

test('INTAKE with no open intake step is due one ask_human conversation card, with no commands', () => {
  const d = due(started());
  assert.deepEqual(d, [{ kind: 'ask_human', stage: 'INTAKE', attempt: 1, card: intakeCard() }]);
  assert.equal(d[0].card!.type, 'intake');
  assert.deepEqual(d[0].card!.commands, []);
});

const INTAKE_FRONT = { limit_min: 120, ui_free: false, reviewer_overrides: { add: [], remove: [] } };

test('INTAKE: the open conversation blocks a second one; once reported with a valid intake the confirm card is due, once; terminal phases are due nothing, and so are BUILD, WRAP and MERGED without slices or probes', () => {
  const w = writer();
  const chat = w.issue({ kind: 'ask_human', stage: 'INTAKE', attempt: 1, card: intakeCard(), output_path: '/o/out.md' });
  assert.deepEqual(due(w.s), []);
  w.put('step_claimed', { step_id: chat });
  assert.deepEqual(due(w.s), [], 'claimed: the human and the conductor are talking');
  w.put('step_reported', { step_id: chat, output: { status: 'DONE', front: INTAKE_FRONT, sha256: 'x', path: '/o/out.md' } });
  const d = due(w.s);
  assert.deepEqual(d, [{ kind: 'ask_human', stage: 'INTAKE', attempt: 1, card: intakeConfirmCard({ ...INTAKE_FRONT, slice_timebox_min: 30 }) }]);
  assert.deepEqual([d[0].card!.reason, d[0].card!.commands], ['limit 2:00 · slice time box 30 min · UI-free no · reviewers: default', ['/factory approve intake']]);
  w.issue(d[0]);
  assert.deepEqual(due(w.s), [], 'one confirm card');
  // BUILD with no slice, WRAP without the CLI's git probe, MERGED outside the worktree, and the
  // terminal phases: nothing to issue (the 1-5 cases are below).
  for (const phase of ['BUILD', 'WRAP', 'MERGED', 'COMPLETED', 'ABANDONED'] as const) {
    assert.deepEqual(due({ ...initialState(), run_id: 'r', phase }), [], phase);
  }
  assert.deepEqual(due({ ...initialState(), run_id: 'r', phase: 'COMPLETED' }, IN), []);
});

test('ORIENT: one recon spawn unless the cache hit or one exists; greenfield is one framer spawn at FRAME (5-2)', () => {
  const w = writer();
  w.put('intake_confirmed', { prompt_fact_id: 'f' }, { actor: 'human' });
  assert.deepEqual(due(w.s, OUT), [{ kind: 'spawn', stage: 'RECON', attempt: 1, role: 'recon', agent: 'd2t-factory:recon' }]);
  assert.deepEqual(due(w.s, { in_worktree: false, recon_cached: true }), []);
  const FRAMER = { kind: 'spawn', stage: 'FRAME', attempt: 1, role: 'framer', agent: 'd2t-factory:framer' };
  assert.deepEqual(due({ ...w.s, greenfield: true }, OUT), [FRAMER]);
  assert.deepEqual(due({ ...w.s, greenfield: true }, { in_worktree: false, recon_cached: true }), [FRAMER], 'FRAME is never cached');
  w.issue({ kind: 'spawn', stage: 'RECON', attempt: 1, role: 'recon', agent: 'd2t-factory:recon' });
  assert.deepEqual(due(w.s, OUT), []);
});

test('ORIENT, greenfield (5-2): an open framer blocks a second; a verified one rerun (voided) is due again with attempt + 1', () => {
  const g = fold([{ v: 1, id: 'A', ts: 't', run: 'r', kind: 'run_started', actor: 'cli', corr: '', data: { task: 't', repo_hash: 'h', base_sha: 's', branch: 'b', greenfield: true } } as any]);
  let s = g;
  const put = (id: string, kind: string, data: object): void => {
    const r = apply(s, { v: 1, id, ts: 't', run: 'r', kind, actor: 'cli', corr: '', session: 'S', data } as AnyEvent);
    assert.ok(r.ok, `${kind}: ${r.reason}`);
    s = r.state;
  };
  put('E1', 'intake_confirmed', { prompt_fact_id: 'f' });
  put('F1', 'step_issued', { kind: 'spawn', stage: 'FRAME', attempt: 1, role: 'framer', agent: 'd2t-factory:framer' });
  assert.deepEqual(due(s, OUT), []);
  put('E2', 'step_claimed', { step_id: 'F1' });
  put('E3', 'step_reported', { step_id: 'F1', output: { status: 'DONE' } });
  put('E4', 'step_verified', { step_id: 'F1', evidence: [] });
  assert.deepEqual(due(s, OUT), [], 'verified: the CLI completes FRAME');
  assert.deepEqual(due({ ...s, voided: ['F1', 'E4'] }, OUT), [{ kind: 'spawn', stage: 'FRAME', attempt: 2, role: 'framer', agent: 'd2t-factory:framer' }]);
});

test('SCAFFOLD: enter_worktree from outside, then the scaffolder, then install once it reported a contract, then health and test once install passed', () => {
  const w = writer();
  w.put('intake_confirmed', { prompt_fact_id: 'f' }, { actor: 'human' });
  w.put('stage_completed', { stage: 'RECON' });
  assert.deepEqual(due(w.s, OUT), [], 'no worktree yet: the CLI makes it');
  w.put('stage_started', { stage: 'SCAFFOLD', port: 5100, worktree: '/r/.claude/worktrees/factory-r' });
  assert.deepEqual(due(w.s, OUT), [{ kind: 'enter_worktree', stage: 'SCAFFOLD', attempt: 1 }]);
  w.issue({ kind: 'enter_worktree', stage: 'SCAFFOLD', attempt: 1 });
  assert.deepEqual(due(w.s, OUT), [], 'one enter_worktree at a time');
  assert.deepEqual(due(w.s, IN).map((d) => d.role), ['scaffolder']);
  const sc = w.issue({ kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder', agent: 'd2t-factory:scaffolder' });
  assert.deepEqual(due(w.s, IN), []);
  w.put('step_claimed', { step_id: sc });
  w.put('step_reported', { step_id: sc, output: { status: 'DONE', front: { port: 5100 } } });
  assert.deepEqual(due(w.s, IN).map((d) => [d.kind, d.check]), [['run_check', 'contract.install']]);
  const inst = w.issue({ kind: 'run_check', stage: 'SCAFFOLD', attempt: 1, check: 'contract.install' });
  assert.deepEqual(due(w.s, IN), [], 'install running: nothing else');
  w.finish(inst, { check: 'contract.install', exit_code: 0 });
  assert.deepEqual(due(w.s, IN).map((d) => [d.kind, d.check]), [['run_check', 'contract.health'], ['run_check', 'contract.test']]);
  w.issue({ kind: 'run_check', stage: 'SCAFFOLD', attempt: 1, check: 'contract.health' });
  assert.deepEqual(due(w.s, IN).map((d) => d.check), ['contract.test']);
});

test('SCAFFOLD: a failed install issues neither health nor test', () => {
  const w = writer();
  w.put('intake_confirmed', { prompt_fact_id: 'f' }, { actor: 'human' });
  w.put('stage_completed', { stage: 'RECON' });
  w.put('stage_started', { stage: 'SCAFFOLD', port: 5100, worktree: '/r/.claude/worktrees/factory-r' });
  const sc = w.issue({ kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder', agent: 'd2t-factory:scaffolder' });
  w.put('step_claimed', { step_id: sc });
  w.put('step_reported', { step_id: sc, output: { status: 'DONE', front: { port: 5100 } } });
  const inst = w.issue({ kind: 'run_check', stage: 'SCAFFOLD', attempt: 1, check: 'contract.install' });
  w.finish(inst, { check: 'contract.install', exit_code: 7 });
  assert.deepEqual(due(w.s, IN), []);
});

test('an open escalation is due as an ask_human step carrying its card, once', () => {
  const w = writer();
  w.put('intake_confirmed', { prompt_fact_id: 'f' }, { actor: 'human' });
  const r = w.issue({ kind: 'spawn', stage: 'RECON', attempt: 1, role: 'recon', agent: 'd2t-factory:recon' });
  const card = { type: 'escalation', title: 'Scope change', commands: ['/factory rule E1 retry <note…>'], escalation: 'E1' };
  w.put('ask_raised', { card, step_id: r, escalation: 'E1' });
  const d = due(w.s, OUT);
  assert.deepEqual(d, [{ kind: 'ask_human', stage: 'RECON', attempt: 1, card }]);
  w.issue(d[0]);
  assert.deepEqual(due(w.s, OUT), []);
});

function toSpec() {
  const w = writer();
  w.put('intake_confirmed', { prompt_fact_id: 'f' }, { actor: 'human' });
  w.put('stage_completed', { stage: 'RECON' });
  const sc = w.issue({ kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder', agent: 'd2t-factory:scaffolder' });
  w.finish(sc);
  assert.equal(w.s.phase, 'SPEC_DESIGN');
  return w;
}
const SPEC_OUT = { status: 'DONE', front: { acceptance: [{ id: 'AC-1', check: { kind: 'command', command: 'x' } }], assumptions: ['a', 'b'] }, sha256: 'd1', path: '/p/spec.md' };

test('SPEC: spec-writer → spec.lint → gate_1 card; a voided spec is due again with attempt + 1', () => {
  const w = toSpec();
  assert.deepEqual(due(w.s, IN).map((d) => [d.kind, d.role]), [['spawn', 'spec-writer']]);
  const sw = w.issue({ kind: 'spawn', stage: 'SPEC', attempt: 1, role: 'spec-writer', agent: 'd2t-factory:spec-writer' });
  w.finish(sw, SPEC_OUT);
  assert.deepEqual(due(w.s, IN), [{ kind: 'run_check', stage: 'SPEC', attempt: 1, check: 'spec.lint' }]);
  const lint = w.issue({ kind: 'run_check', stage: 'SPEC', attempt: 1, check: 'spec.lint' });
  assert.deepEqual(due(w.s, IN), []);
  w.finish(lint, { exit_code: 0, errors: [] });
  const [g] = due(w.s, IN);
  assert.equal(g.card!.type, 'gate_1');
  assert.match(g.card!.reason!, /\/p\/spec\.md · 2 assumptions to check/);
  assert.deepEqual(g.card!.commands, ['/factory approve gate1', '/factory rework gate1 <note…>']);
  const gate = w.issue(g);
  assert.deepEqual(due(w.s, IN), []);
  // rework gate1: the decision verifies the card and voids the spec.
  w.put('rework_requested', { prompt_fact_id: 'f', target: 'gate1', note: 'n', voids: [sw] }, { actor: 'human' });
  w.put('step_claimed', { step_id: gate });
  w.put('step_verified', { step_id: gate, evidence: [] });
  assert.deepEqual(due(w.s, IN).map((d) => [d.role, d.attempt]), [['spec-writer', 2]]);
});

test('a failing spec.lint raises the gate_1 card without approve', () => {
  const w = toSpec();
  const sw = w.issue({ kind: 'spawn', stage: 'SPEC', attempt: 1, role: 'spec-writer', agent: 'd2t-factory:spec-writer' });
  w.finish(sw, SPEC_OUT);
  const lint = w.issue({ kind: 'run_check', stage: 'SPEC', attempt: 1, check: 'spec.lint' });
  w.finish(lint, { exit_code: 1, errors: ['no Assumptions section'] });
  const [g] = due(w.s, IN);
  assert.deepEqual(g.card!.commands, ['/factory rework gate1 <note…>']);
  assert.match(g.card!.reason!, /spec\.lint failed: no Assumptions section/);
});

const SLICER = { kind: 'spawn', stage: 'SLICE_PLAN', attempt: 1, role: 'slicer', agent: 'd2t-factory:slicer' };
const PLAN_LINT = { kind: 'run_check', stage: 'SLICE_PLAN', attempt: 1, check: 'plan.lint' };

test('SLICE_PLAN (3-3): slicer → plan.lint → gate_2 card with tags, deps and rosters; a gate-2 rework voids the slicer, so a fresh one (attempt 2) and a fresh lint are due', () => {
  const w = toSpec();
  const sw = w.issue({ kind: 'spawn', stage: 'SPEC', attempt: 1, role: 'spec-writer', agent: 'd2t-factory:spec-writer' });
  w.finish(sw, SPEC_OUT);
  w.put('gate_1_passed', { prompt_fact_id: 'f' }, { actor: 'human' });
  assert.deepEqual(due(w.s, IN), [SLICER], 'the slicer first, not plan.lint');
  const sl = w.issue(SLICER);
  assert.deepEqual(due(w.s, IN), [], 'the slicer is at work');
  w.finish(sl, { status: 'DONE', front: { slices: [] } });
  assert.deepEqual(due(w.s, IN), [PLAN_LINT], 'plan.lint only after the verified slicer');
  const lint = w.issue(PLAN_LINT);
  assert.deepEqual(due(w.s, IN), []);
  const plan = [
    { id: 'S1', title: 'Signup form', acs: ['AC-1'], tags: ['ui', 'input'], deps: [], roster: ['reviewer-code', 'reviewer-security', 'reviewer-ux', 'reviewer-a11y', 'reviewer-ui'] },
    { id: 'S2', title: 'Welcome mail', acs: ['AC-1'], tags: [], deps: ['S1'], roster: ['reviewer-code'] },
  ];
  w.finish(lint, { exit_code: 0, errors: [], plan });
  const [g] = due(w.s, IN);
  assert.equal(g.card!.type, 'gate_2');
  assert.equal(g.card!.reason, '2 slices: S1 Signup form (AC-1) [ui, input] · code, security, ux, a11y, ui; S2 Welcome mail (AC-1) ← S1 · code');
  const gate = w.issue(g);
  assert.deepEqual(due(w.s, IN), []);
  // /factory rework gate2: the card answered, the slicer, its step_verified and the lint voided.
  w.put('step_claimed', { step_id: gate });
  w.put('step_verified', { step_id: gate, evidence: [] });
  w.put('rework_requested', { prompt_fact_id: 'f', target: 'gate2', note: 'split S1', voids: [sl, w.s.steps[lint].output!.check_id ?? 'x'] }, { actor: 'human' });
  assert.deepEqual(due(w.s, IN), [{ ...SLICER, attempt: 2 }]);
  const sl2 = w.issue({ ...SLICER, attempt: 2 });
  w.finish(sl2, { status: 'DONE', front: { slices: [] } });
  assert.deepEqual(due(w.s, IN), [PLAN_LINT], 'a fresh lint of the new plan');
  // A failing lint: the card shows its errors and offers rework only.
  const lint2 = w.issue(PLAN_LINT);
  w.finish(lint2, { exit_code: 1, errors: ['AC-1 is in no slice'], plan: [] });
  const [bad] = due(w.s, IN);
  assert.deepEqual([bad.card!.reason, bad.card!.commands], ['0 slices:  · plan.lint failed: AC-1 is in no slice', ['/factory rework gate2 <note…>']]);
});

// --- 3-2: the designer beside the spec ---------------------------------------------------------

const INTAKE = { limit_min: 120, slice_timebox_min: 30, ui_free: false, reviewer_overrides: { add: [], remove: [] } };
// SPEC_DESIGN after a RECON context and a confirmed intake.
function toSpecDesign(o: { ui_surface?: boolean; ui_free?: boolean; origin?: string; intake?: boolean } = {}) {
  const w = writer();
  w.put('intake_confirmed', { prompt_fact_id: 'f', ...(o.intake === false ? {} : { intake: { ...INTAKE, ui_free: o.ui_free ?? false } }) }, { actor: 'human' });
  w.put('stage_completed', { stage: 'RECON', recon: { path: '/c.md', sha256: 'c', context: { origin: o.origin ?? 'brownfield', ui_surface: o.ui_surface ?? true } } });
  const sc = w.issue({ kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder', agent: 'd2t-factory:scaffolder' });
  w.finish(sc);
  assert.equal(w.s.phase, 'SPEC_DESIGN');
  return w;
}
const DESIGNER = { kind: 'spawn', stage: 'DESIGN', attempt: 1, role: 'designer', agent: 'd2t-factory:designer' };
const SPEC_WRITER = { kind: 'spawn', stage: 'SPEC', attempt: 1, role: 'spec-writer', agent: 'd2t-factory:spec-writer' };
const QUESTION = { question: 'Light or dark?', a: 'Light', b: 'Dark', default: 'a' as const };
const designOut = (o: { question?: object; assumptions?: string[]; mode?: string } = {}) => ({
  status: 'DONE', front: { mode: o.mode ?? 'inherit', colors: { primary: '#000' }, assumptions: o.assumptions ?? ['x'] }, sha256: 'dd', path: '/p/design.md', ...(o.question ? { question: o.question } : {}),
});
// The spec side up to a passing spec.lint.
function specLinted(w: ReturnType<typeof writer>): string {
  const sw = w.issue(SPEC_WRITER);
  w.finish(sw, SPEC_OUT);
  const lint = w.issue({ kind: 'run_check', stage: 'SPEC', attempt: 1, check: 'spec.lint' });
  w.finish(lint, { exit_code: 0, errors: [] });
  return sw;
}

test('SPEC_DESIGN with ui_surface and not UI-free: spec-writer and designer are due together; without either (or without intake fields) only the spec-writer', () => {
  assert.deepEqual(due(toSpecDesign().s, IN), [SPEC_WRITER, DESIGNER]);
  for (const o of [{ ui_surface: false }, { ui_free: true }, { intake: false }]) {
    assert.deepEqual(due(toSpecDesign(o).s, IN), [SPEC_WRITER], JSON.stringify(o));
  }
  // No designer: the gate_1 card is today's, spec only.
  const w = toSpecDesign({ ui_free: true });
  specLinted(w);
  const [g] = due(w.s, IN);
  assert.deepEqual(g.card, gate1Card({ spec_path: '/p/spec.md', assumptions: 2, lint: { ok: true, errors: [] } }));
  assert.equal(g.card!.title, 'Gate 1 — approve the spec');
});

test('gate 1 waits for the design; then `Gate 1 — Spec + Design ready` names both files and counts both assumption lists', () => {
  const w = toSpecDesign();
  const d = w.issue(DESIGNER);
  specLinted(w);
  assert.deepEqual(due(w.s, IN), [], 'the designer is still running');
  w.put('step_claimed', { step_id: d });
  w.put('step_reported', { step_id: d, output: designOut() });
  assert.deepEqual(due(w.s, IN), [], 'reported, not yet verified');
  w.put('step_verified', { step_id: d, evidence: [] });
  const [g] = due(w.s, IN);
  assert.equal(g.stage, 'SPEC');
  assert.deepEqual([g.card!.title, g.card!.reason, g.card!.commands], [
    'Gate 1 — Spec + Design ready', '/p/spec.md · /p/design.md (inherit) · 3 assumptions to check', ['/factory approve gate1', '/factory rework gate1 <note…>'],
  ]);
});

test('a design question: the design_choice card (stage DESIGN) once; gate 1 waits for its answer; the default keeps the design; the other option voids it and a designer is due again with attempt + 1', () => {
  const w = toSpecDesign({ origin: 'greenfield' });
  const d = w.issue(DESIGNER);
  w.finish(d, designOut({ mode: 'invent', question: QUESTION }));
  specLinted(w);
  const ds = due(w.s, IN);
  assert.deepEqual(ds, [{ kind: 'ask_human', stage: 'DESIGN', attempt: 1, card: designChoiceCard(QUESTION) }], 'only the question: gate 1 waits');
  assert.deepEqual([ds[0].card!.title, ds[0].card!.commands], ['Design question — Light or dark?', ['/factory choose a', '/factory choose b']]);
  const card = w.issue(ds[0]);
  assert.deepEqual(due(w.s, IN), [], 'one card');
  // Default: the card is verified, the design stands, gate 1 follows.
  const w2 = structuredClone(w.s);
  w.put('design_choice_made', { prompt_fact_id: 'f', choice: 'a' }, { actor: 'human' });
  w.put('step_claimed', { step_id: card });
  w.put('step_verified', { step_id: card, evidence: [] });
  assert.deepEqual(due(w.s, IN).map((x) => x.card?.type), ['gate_1']);
  assert.match(due(w.s, IN)[0].card!.reason!, /design\.md \(invent\)/);
  // The other option voids the designer step: a designer is due again; no gate 1 meanwhile.
  let s = w2;
  for (const [kind, data, extra] of [
    ['design_choice_made', { prompt_fact_id: 'f', choice: 'b', voids: [d] }, { actor: 'human' }],
    ['step_claimed', { step_id: card }, {}], ['step_verified', { step_id: card, evidence: [] }, {}],
  ] as const) {
    const r = apply(s, { v: 1, id: `X${kind}`, ts: 't', run: 'r', kind, actor: 'cli', corr: '', session: 'S', data, ...extra } as AnyEvent);
    assert.ok(r.ok, r.reason);
    s = r.state;
  }
  assert.deepEqual(due(s, IN), [{ ...DESIGNER, attempt: 2 }]);
});

// --- 1-5: BUILD, WRAP, MERGED ---------------------------------------------------------------------

// BUILD with these slices in BACKLOG (gate 2 passed); S1 by default.
function toBuildWith(ids: readonly string[], rosters: Record<string, string[]> = {}, deps: Record<string, string[]> = {}) {
  const w = toSpec();
  const sw = w.issue({ kind: 'spawn', stage: 'SPEC', attempt: 1, role: 'spec-writer', agent: 'd2t-factory:spec-writer' });
  w.finish(sw, SPEC_OUT);
  w.put('gate_1_passed', { prompt_fact_id: 'f' }, { actor: 'human' });
  w.put('gate_2_passed', { prompt_fact_id: 'f', slices: ids.map((id) => ({ id, title: id === 'S1' ? 't' : id, acs: ['AC-1'], ...(deps[id] ? { deps: deps[id] } : {}), ...(rosters[id] ? { roster: rosters[id] } : {}) })) }, { actor: 'human' });
  assert.equal(w.s.phase, 'BUILD');
  return w;
}
function toBuildState() { return toBuildWith(['S1']); }
const BUILDER = { kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'builder', agent: 'd2t-factory:builder', slice: 'S1' };
const TEST = { kind: 'run_check', stage: 'BUILD', attempt: 1, check: 'contract.test', slice: 'S1' };
const REVIEWER = { kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'reviewer-code', agent: 'd2t-factory:reviewer-code', slice: 'S1' };

// One run_check step that ran `check` at `sha` with `exit_code`.
function ranCheck(w: ReturnType<typeof writer>, step: object, exit_code: number, sha: string): string {
  const id = w.issue(step);
  const ck = w.put('check_ran', { check: (step as { check: string }).check, exit_code, duration_ms: 1, basis_seq: 1, sha });
  w.finish(id, { check_id: ck, exit_code });
  return id;
}
function review(w: ReturnType<typeof writer>, verdict: string, role = 'reviewer-code', slice = 'S1'): string {
  const id = w.issue({ ...REVIEWER, role, agent: `d2t-factory:${role}`, slice });
  w.put('step_claimed', { step_id: id });
  w.put('step_reported', { step_id: id, output: { status: verdict } });
  w.put('step_verified', { step_id: id, evidence: [], verdict });
  return id;
}
function builderDone(w: ReturnType<typeof writer>, d: object, sha: string): string {
  const id = w.issue(d);
  w.put('step_claimed', { step_id: id });
  w.put('step_reported', { step_id: id, sha, output: { status: 'DONE' } });
  w.put('step_verified', { step_id: id, evidence: [] });
  return id;
}

test('BUILD: the CLI starts S1; then builder → contract.test → reviewer-code; a failing test or FINDINGS is a builder round (a resume when the CLI names the agent) until the cap', () => {
  const w = toBuildState();
  assert.deepEqual(due(w.s, IN), [], 'BACKLOG: the CLI appends slice_started');
  w.put('slice_started', { slice: 'S1' });
  assert.deepEqual(due(w.s, IN), [BUILDER]);
  const b0 = builderDone(w, BUILDER, 'c1');
  assert.equal(w.s.slices.S1.state, 'IN_REVIEW');
  assert.deepEqual(due(w.s, IN), [TEST]);
  const t0 = w.issue(TEST);
  assert.deepEqual(due(w.s, IN), [], 'the test is running');
  const ck = w.put('check_ran', { check: 'contract.test', exit_code: 1, duration_ms: 1, basis_seq: 1, sha: 'c1' });
  w.finish(t0, { check_id: ck, exit_code: 1 });
  // A failing test: a builder round, resumed when the CLI found the agent.
  assert.deepEqual(due(w.s, { ...IN, resume_agents: { S1: 'ag-1' } }), [{ ...BUILDER, kind: 'resume', agent_id: 'ag-1' }]);
  builderDone(w, { ...BUILDER, kind: 'resume', agent_id: 'ag-1' }, 'c2');
  assert.deepEqual([w.s.slices.S1.rounds, w.s.slices.S1.state], [1, 'IN_REVIEW']);
  assert.deepEqual(due(w.s, IN), [TEST], 'a new test after the new builder commit');
  ranCheck(w, TEST, 0, 'c2');
  assert.deepEqual(due(w.s, IN), [REVIEWER]);
  review(w, 'FINDINGS');
  assert.equal(w.s.slices.S1.state, 'FINDINGS_QUEUED');
  assert.deepEqual(due(w.s, IN), [BUILDER], 'no agent to resume: a spawn');
  builderDone(w, BUILDER, 'c3');
  assert.equal(w.s.slices.S1.rounds, 2);
  ranCheck(w, TEST, 0, 'c3');
  review(w, 'FINDINGS');
  assert.deepEqual(due(w.s, IN), [], 'at MAX_RETRIGGER_ROUNDS the CLI raises Non-convergence instead');
  assert.ok(b0);
});

test('BUILD: an open step of the slice or an escalated slice is due nothing; APPROVE leaves the close to the CLI', () => {
  const w = toBuildState();
  w.put('slice_started', { slice: 'S1' });
  const b = w.issue(BUILDER);
  w.put('step_claimed', { step_id: b });
  w.put('ask_raised', { card: { type: 'escalation', title: 'x', commands: [] }, step_id: b, slice: 'S1', escalation: 'E1' });
  assert.equal(w.s.slices.S1.state, 'ESCALATED');
  assert.deepEqual(due(w.s, IN).map((d) => d.kind), ['ask_human'], 'only the escalation card');
  const w2 = toBuildState();
  w2.put('slice_started', { slice: 'S1' });
  builderDone(w2, BUILDER, 'c1');
  ranCheck(w2, TEST, 0, 'c1');
  review(w2, 'APPROVE');
  assert.deepEqual(due(w2.s, IN), []);
});

// --- 3-3: the reviewer roster in a round ---------------------------------------------------------

const ALL = ['reviewer-code', 'reviewer-security', 'reviewer-ux', 'reviewer-a11y', 'reviewer-ui'];
const reviewer = (role: string, slice = 'S1') => ({ ...REVIEWER, role, agent: `d2t-factory:${role}`, slice });
const HEALTH_B = { kind: 'run_check', stage: 'BUILD', attempt: 1, check: 'contract.health', slice: 'S1' };

test('BUILD (3-3): round 1 issues the diff reviewers with contract.health together, the running-app reviewers once health passed; after FINDINGS only the raising reviewer re-checks', () => {
  const w = toBuildWith(['S1'], { S1: ALL });
  w.put('slice_started', { slice: 'S1' });
  builderDone(w, BUILDER, 'c1');
  assert.deepEqual(due(w.s, IN), [TEST], 'the test first, as before');
  ranCheck(w, TEST, 0, 'c1');
  assert.deepEqual(due(w.s, IN), [reviewer('reviewer-code'), reviewer('reviewer-security'), HEALTH_B]);
  const h = w.issue(HEALTH_B);
  const code = review(w, 'APPROVE');
  assert.deepEqual(due(w.s, IN), [reviewer('reviewer-security')], 'each due role once per round; app reviewers wait for health');
  const sec = review(w, 'FINDINGS', 'reviewer-security');
  assert.equal(w.s.slices.S1.state, 'FINDINGS_QUEUED');
  assert.deepEqual(due(w.s, IN), [], 'health still running: no builder yet');
  const hc = w.put('check_ran', { check: 'contract.health', exit_code: 0, duration_ms: 1, basis_seq: 1, sha: 'c1' });
  w.finish(h, { check_id: hc, exit_code: 0 });
  assert.deepEqual(due(w.s, IN), [reviewer('reviewer-ux'), reviewer('reviewer-a11y'), reviewer('reviewer-ui')], 'after health passed, even with findings queued');
  for (const role of ['reviewer-ux', 'reviewer-a11y', 'reviewer-ui']) review(w, 'APPROVE', role);
  // The round settled with security at FINDINGS: a builder round, then only security re-checks.
  assert.deepEqual(due(w.s, IN), [BUILDER]);
  builderDone(w, BUILDER, 'c2');
  assert.equal(w.s.slices.S1.rounds, 1);
  ranCheck(w, TEST, 0, 'c2');
  assert.deepEqual(due(w.s, IN), [reviewer('reviewer-security')], 'no health: no running-app reviewer is due');
  review(w, 'APPROVE', 'reviewer-security');
  assert.deepEqual(due(w.s, IN), [], 'every rostered role approved: the CLI closes the slice');
  assert.ok(code && sec);
});

test('BUILD (3-3): a failing health check is a failed round; the running-app reviewers it kept out are due the next round', () => {
  const w = toBuildWith(['S1'], { S1: ['reviewer-code', 'reviewer-ux'] });
  w.put('slice_started', { slice: 'S1' });
  builderDone(w, BUILDER, 'c1');
  ranCheck(w, TEST, 0, 'c1');
  assert.deepEqual(due(w.s, IN), [reviewer('reviewer-code'), HEALTH_B]);
  ranCheck(w, HEALTH_B, 1, 'c1');
  assert.deepEqual(due(w.s, IN), [reviewer('reviewer-code')], 'the diff reviewer still runs this round; no builder before it reports');
  review(w, 'APPROVE');
  assert.equal(w.s.slices.S1.state, 'IN_REVIEW');
  assert.deepEqual(due(w.s, IN), [BUILDER], 'health failed: a builder round');
  builderDone(w, BUILDER, 'c2');
  assert.equal(w.s.slices.S1.rounds, 1);
  ranCheck(w, TEST, 0, 'c2');
  assert.deepEqual(due(w.s, IN), [HEALTH_B], 'reviewer-code approved; reviewer-ux never ran, so it is due, behind health');
  ranCheck(w, HEALTH_B, 0, 'c2');
  assert.deepEqual(due(w.s, IN), [reviewer('reviewer-ux')]);
});

test('BUILD (3-3): a [reviewer-code] roster issues exactly what a slice without a roster does', () => {
  const steps = (rosters: Record<string, string[]>): unknown[] => {
    const w = toBuildWith(['S1'], rosters);
    const seen: unknown[] = [];
    const at = () => { const d = due(w.s, IN); seen.push(d); return d; };
    w.put('slice_started', { slice: 'S1' });
    at();
    builderDone(w, BUILDER, 'c1');
    at();
    ranCheck(w, TEST, 0, 'c1');
    at();
    review(w, 'FINDINGS');
    at();
    builderDone(w, BUILDER, 'c2');
    at();
    ranCheck(w, TEST, 1, 'c2');
    at();
    builderDone(w, BUILDER, 'c3');
    ranCheck(w, TEST, 0, 'c3');
    at();
    review(w, 'APPROVE');
    at();
    return seen;
  };
  assert.deepEqual(steps({ S1: ['reviewer-code'] }), steps({}));
});

// WRAP after one approved round.
function toWrapState() {
  const w = toBuildState();
  w.put('slice_started', { slice: 'S1' });
  builderDone(w, BUILDER, 'c1');
  const t = ranCheck(w, TEST, 0, 'c1');
  review(w, 'APPROVE');
  w.put('slice_closed', { slice: 'S1', check_id: w.s.steps[t].output!.check_id });
  w.put('stage_completed', { stage: 'BUILD' });
  assert.equal(w.s.phase, 'WRAP');
  return w;
}
const PROBE: WrapProbe = { head: 'h1', target: 't1', branch: 'main', diffstat: '1 file changed, 1 insertion(+)', problems: [] };
const HEALTH_W = { kind: 'run_check', stage: 'WRAP', attempt: 1, check: 'contract.health' };
const TEST_W = { kind: 'run_check', stage: 'WRAP', attempt: 1, check: 'contract.test' };

test('WRAP: health, then test, at the branch head, then (after the CLI baseline) the merge card pinned to head and target; a new head needs fresh checks', () => {
  const w = toWrapState();
  assert.deepEqual(due(w.s, IN), [], 'no probe, nothing');
  const ctx = { ...IN, wrap: PROBE };
  assert.deepEqual(due(w.s, ctx), [HEALTH_W], 'health first: it restarts the dev server');
  const h = w.issue(HEALTH_W);
  assert.deepEqual(due(w.s, ctx), [], 'the test waits for health');
  const hc = w.put('check_ran', { check: 'contract.health', exit_code: 1, duration_ms: 1, basis_seq: 1, sha: 'h1' });
  w.finish(h, { check_id: hc, exit_code: 1 });
  assert.deepEqual(due(w.s, ctx), [TEST_W], 'after health is in, passed or failed');
  ranCheck(w, HEALTH_W, 0, 'h1');
  ranCheck(w, TEST_W, 0, 'h1');
  assert.deepEqual(due(w.s, ctx), [], 'the CLI runs git.baseline inline first');
  w.put('check_ran', { check: 'git.baseline', exit_code: 0, duration_ms: 1, basis_seq: 1, sha: 'h1', digest: 'd' });
  const [m] = due(w.s, ctx);
  assert.deepEqual([m.kind, m.stage, m.card!.type, m.card!.sha, m.card!.target], ['ask_human', 'WRAP', 'merge', 'h1', 't1']);
  assert.deepEqual(m.card!.commands, ['/factory merge', '/factory rework S1 <note…>', '/factory abandon']);
  assert.match(m.card!.reason!, /^S1 t · reviewer-code APPROVE · 0 rounds · h1 into main · 1 file changed, 1 insertion\(\+\) · contract\.test passed$/);
  const card = w.issue(m);
  assert.deepEqual(due(w.s, ctx), [], 'one card at a time');
  // The run branch moved: the stale card is closed by the CLI, then the checks are due again.
  const moved = { ...IN, wrap: { ...PROBE, head: 'h2' } };
  assert.deepEqual(due(w.s, moved), []);
  w.put('step_claimed', { step_id: card });
  w.put('step_verified', { step_id: card, evidence: ['superseded'] });
  assert.deepEqual(due(w.s, moved), [HEALTH_W]);
  assert.deepEqual(due(w.s, ctx), [], 'the same head and target: the answered card is not raised again');
});

test('WRAP: a probe problem (conflicts) raises a card without merge and without checks, and a new problem a fresh card; a failing check or baseline blocks it; a failed merge re-raises it, still offering the merge', () => {
  const w = toWrapState();
  const conflict = { ...IN, wrap: { ...PROBE, problems: ['conflicts with main: footer.js'] } };
  const [c] = due(w.s, conflict);
  assert.deepEqual(c.card!.commands, ['/factory rework S1 <note…>', '/factory abandon']);
  assert.match(c.card!.reason!, /conflicts with main: footer\.js/);
  assert.equal(c.card!.title, 'Merge — blocked');
  const cid = w.issue(c);
  w.put('step_claimed', { step_id: cid });
  w.put('step_verified', { step_id: cid, evidence: ['superseded'] });
  assert.deepEqual(due(w.s, conflict), [], 'the same problem: not raised again');
  const progress = { ...IN, wrap: { ...PROBE, problems: ['a merge is in progress in the worktree'] } };
  assert.match(due(w.s, progress)[0].card!.reason!, /a merge is in progress/);
  const ctx = { ...IN, wrap: PROBE };
  ranCheck(w, HEALTH_W, 0, 'h1');
  ranCheck(w, TEST_W, 3, 'h1');
  w.put('check_ran', { check: 'git.baseline', exit_code: 1, duration_ms: 1, basis_seq: 1, sha: 'h1', digest: 'x' });
  const [b] = due(w.s, ctx);
  assert.deepEqual(b.card!.commands, ['/factory rework S1 <note…>', '/factory abandon']);
  assert.match(b.card!.reason!, /contract\.test failed \(exit 3\) · the main checkout differs from its baseline$/);
  // A card answered by merge, whose git merge then failed, is raised again.
  const w2 = toWrapState();
  ranCheck(w2, HEALTH_W, 0, 'h1');
  ranCheck(w2, TEST_W, 0, 'h1');
  w2.put('check_ran', { check: 'git.baseline', exit_code: 0, duration_ms: 1, basis_seq: 1, sha: 'h1', digest: 'd' });
  const card = w2.issue(due(w2.s, ctx)[0]);
  w2.put('merge_approved', { prompt_fact_id: 'f' }, { actor: 'human' });
  w2.put('step_claimed', { step_id: card });
  w2.put('step_verified', { step_id: card, evidence: [] });
  assert.deepEqual(due(w2.s, ctx), []);
  w2.put('check_ran', { check: 'git.merged', exit_code: 1, duration_ms: 1, basis_seq: 1 });
  const [again] = due(w2.s, ctx);
  assert.match(again.card!.reason!, /the last git merge failed \(exit 1\) and was aborted$/);
  assert.deepEqual(again.card!.commands, ['/factory merge', '/factory rework S1 <note…>', '/factory abandon']);
  w2.issue(again);
  // A newer git.baseline at the head (the CLI refreshed a baseline-blocked card) needs a fresh card.
  const w3 = toWrapState();
  ranCheck(w3, HEALTH_W, 0, 'h1');
  ranCheck(w3, TEST_W, 0, 'h1');
  w3.put('check_ran', { check: 'git.baseline', exit_code: 1, duration_ms: 1, basis_seq: 1, sha: 'h1', digest: 'x' });
  const blocked = w3.issue(due(w3.s, ctx)[0]);
  w3.put('step_claimed', { step_id: blocked });
  w3.put('step_verified', { step_id: blocked, evidence: ['superseded'] });
  assert.deepEqual(due(w3.s, ctx), []);
  w3.put('check_ran', { check: 'git.baseline', exit_code: 0, duration_ms: 1, basis_seq: 1, sha: 'h1', digest: 'd' });
  assert.equal(due(w3.s, ctx)[0].card!.commands[0], '/factory merge');
});

test('MERGED: a conductor inside the worktree is due one exit_worktree; outside, nothing', () => {
  const w = toWrapState();
  ranCheck(w, HEALTH_W, 0, 'h1');
  ranCheck(w, TEST_W, 0, 'h1');
  w.put('merge_approved', { prompt_fact_id: 'f' }, { actor: 'human' });
  w.put('merged', { sha: 'm1' });
  assert.equal(w.s.phase, 'MERGED');
  assert.deepEqual(due(w.s, IN), [{ kind: 'exit_worktree', stage: 'WRAP', attempt: 1 }]);
  w.issue({ kind: 'exit_worktree', stage: 'WRAP', attempt: 1 });
  assert.deepEqual(due(w.s, IN), []);
  assert.deepEqual(due(w.s, OUT), []);
});

test('the open cut ask is due as an ask_human step carrying its card, once; closed by cut_decided, it is not due again', () => {
  const w = toBuildWith(['S1', 'S2']);
  const card = cutCard([{ id: 'S1', title: 'one' }, { id: 'S2', title: 'two' }]);
  w.put('ask_raised', { card });
  const d = due(w.s, IN);
  assert.deepEqual(d, [{ kind: 'ask_human', stage: 'BUILD', attempt: 1, card }], 'no builder: no slice is started yet');
  const st = w.issue(d[0]);
  assert.deepEqual(due(w.s, IN), []);
  w.put('cut_decided', { prompt_fact_id: 'f', cut: ['S2'] }, { actor: 'human' });
  w.put('step_claimed', { step_id: st });
  w.put('step_verified', { step_id: st, evidence: [] });
  assert.deepEqual(due(w.s, IN), []);
  assert.deepEqual(Object.values(w.s.asks).map((a) => a.open), [false]);
});

// --- 3-4: the pipelined build loop ---------------------------------------------------------------

const sliceStep = (step: object, slice: string) => ({ ...step, slice });

test('pipeline (3-4): S1 and S2 independent; once S1\'s test passes S2 may start, and one batch issues S1\'s diff reviewer and S2\'s builder; S2 ← S1 waits for S1 to close', () => {
  const w = toBuildWith(['S1', 'S2']);
  assert.equal(nextBacklog(w.s)?.id, 'S1');
  w.put('slice_started', { slice: 'S1' });
  assert.equal(nextBacklog(w.s), undefined, 'S1 is BUILDING');
  builderDone(w, BUILDER, 'c1');
  assert.equal(nextBacklog(w.s), undefined, 'S1 has no passing round test yet');
  assert.deepEqual(due(w.s, IN), [TEST]);
  ranCheck(w, TEST, 0, 'c1');
  assert.equal(nextBacklog(w.s)?.id, 'S2');
  w.put('slice_started', { slice: 'S2' });
  assert.deepEqual(due(w.s, IN), [REVIEWER, sliceStep(BUILDER, 'S2')]);

  // S2 depends on S1: it starts only once S1 is closed.
  const d = toBuildWith(['S1', 'S2'], {}, { S2: ['S1'] });
  d.put('slice_started', { slice: 'S1' });
  builderDone(d, BUILDER, 'c1');
  const t = ranCheck(d, TEST, 0, 'c1');
  assert.equal(nextBacklog(d.s), undefined);
  review(d, 'APPROVE');
  assert.equal(nextBacklog(d.s), undefined, 'approved but not closed yet');
  d.put('slice_closed', { slice: 'S1', check_id: d.s.steps[t].output!.check_id });
  assert.equal(nextBacklog(d.s)?.id, 'S2');
});

test('queued findings (3-4): S1\'s FINDINGS while S2\'s builder is claimed queue; after S2\'s done the builder goes to S1 (resumed), then S1\'s test, then only reviewer-code on S1 with S2\'s test', () => {
  const w = toBuildWith(['S1', 'S2']);
  w.put('slice_started', { slice: 'S1' });
  builderDone(w, BUILDER, 'c1');
  ranCheck(w, TEST, 0, 'c1');
  w.put('slice_started', { slice: 'S2' });
  const rv = w.issue(REVIEWER);
  const b2 = w.issue(sliceStep(BUILDER, 'S2'));
  w.put('step_claimed', { step_id: b2 });
  w.put('step_claimed', { step_id: rv });
  w.put('step_reported', { step_id: rv, output: { status: 'FINDINGS' } });
  w.put('step_verified', { step_id: rv, evidence: [], verdict: 'FINDINGS' });
  assert.equal(w.s.slices.S1.state, 'FINDINGS_QUEUED');
  const ctx = { ...IN, resume_agents: { S1: 'ag-1' } };
  assert.deepEqual(due(w.s, ctx), [], 'the builder is busy on S2: S1 waits, and no check runs beside a builder');
  w.put('step_reported', { step_id: b2, sha: 'c2', output: { status: 'DONE' } });
  w.put('step_verified', { step_id: b2, evidence: [] });
  assert.equal(w.s.slices.S2.state, 'IN_REVIEW');
  assert.deepEqual(due(w.s, ctx), [{ ...BUILDER, kind: 'resume', agent_id: 'ag-1' }], 'the earliest slice that wants the builder gets it; S2\'s test waits behind it');
  builderDone(w, { ...BUILDER, kind: 'resume', agent_id: 'ag-1' }, 'c3');
  assert.deepEqual([w.s.slices.S1.rounds, w.s.slices.S1.state], [1, 'IN_REVIEW']);
  assert.deepEqual(due(w.s, ctx), [TEST], 'S1\'s test first: one check at a time, earliest slice first');
  ranCheck(w, TEST, 0, 'c3');
  assert.deepEqual(due(w.s, ctx), [REVIEWER, sliceStep(TEST, 'S2')], 'only the raising reviewer re-checks S1; S2\'s test beside it');
});

test('app slice (3-4): S1 with reviewer-ux holds S2 back until its health and ux are verified; one writer at a time', () => {
  const w = toBuildWith(['S1', 'S2'], { S1: ['reviewer-code', 'reviewer-ux'] });
  w.put('slice_started', { slice: 'S1' });
  builderDone(w, BUILDER, 'c1');
  ranCheck(w, TEST, 0, 'c1');
  assert.equal(nextBacklog(w.s), undefined, 'a running-app reviewer is still due');
  assert.deepEqual(due(w.s, IN), [REVIEWER, HEALTH_B]);
  ranCheck(w, HEALTH_B, 0, 'c1');
  review(w, 'APPROVE');
  assert.equal(nextBacklog(w.s), undefined, 'health passed, ux not yet verified');
  const ux = w.issue(reviewer('reviewer-ux'));
  assert.equal(nextBacklog(w.s), undefined, 'ux is at work');
  w.put('step_claimed', { step_id: ux });
  w.put('step_reported', { step_id: ux, output: { status: 'APPROVE' } });
  w.put('step_verified', { step_id: ux, evidence: [], verdict: 'APPROVE' });
  assert.equal(nextBacklog(w.s)?.id, 'S2');
  // A cut card holds every start.
  w.put('ask_raised', { card: cutCard([{ id: 'S2' }]) });
  assert.equal(nextBacklog(w.s), undefined);
});

test('an ESCALATED slice (3-4) is issued nothing new; another live slice goes on, and no Backlog slice starts', () => {
  const w = toBuildWith(['S1', 'S2'], { S2: ['reviewer-code', 'reviewer-ux'] });
  w.put('slice_started', { slice: 'S1' });
  builderDone(w, BUILDER, 'c1');
  ranCheck(w, TEST, 0, 'c1');
  w.put('slice_started', { slice: 'S2' });
  w.put('ask_raised', { card: { type: 'escalation', title: 'Over time box (S1)', reason_label: 'Over time box', reason: 'S1 at 30 / 30 min.', commands: [] }, slice: 'S1', escalation: 'E1' });
  assert.equal(w.s.slices.S1.state, 'ESCALATED');
  const d = due(w.s, IN);
  assert.deepEqual(d.map((x) => [x.kind, x.role ?? x.card?.type, x.slice]), [['ask_human', 'escalation', undefined], ['spawn', 'builder', 'S2']], 'S1\'s reviewer is not issued');
  assert.equal(nextBacklog(w.s), undefined);
});

test('no builder moves the head (3-4) while a slice has a passing health and its running-app reviewers not yet issued: S2\'s ux goes first, then S1\'s builder round', () => {
  const w = toBuildWith(['S1', 'S2'], { S2: ['reviewer-code', 'reviewer-ux'] });
  w.put('slice_started', { slice: 'S1' });
  builderDone(w, BUILDER, 'c1');
  ranCheck(w, TEST, 0, 'c1');
  w.put('slice_started', { slice: 'S2' });
  const rv1 = w.issue(REVIEWER);
  w.put('step_claimed', { step_id: rv1 });
  builderDone(w, sliceStep(BUILDER, 'S2'), 'c2');
  ranCheck(w, sliceStep(TEST, 'S2'), 0, 'c2');
  ranCheck(w, sliceStep(HEALTH_B, 'S2'), 0, 'c2');
  // S1's reviewer reports FINDINGS: S1 now wants its builder, earliest in plan order.
  w.put('step_reported', { step_id: rv1, output: { status: 'FINDINGS' } });
  w.put('step_verified', { step_id: rv1, evidence: [], verdict: 'FINDINGS' });
  assert.equal(w.s.slices.S1.state, 'FINDINGS_QUEUED');
  assert.deepEqual(due(w.s, IN), [reviewer('reviewer-code', 'S2'), reviewer('reviewer-ux', 'S2')], 'S2\'s app reviewer first, against the head health judged');
  const ux = w.issue(reviewer('reviewer-ux', 'S2'));
  assert.deepEqual(due(w.s, IN), [reviewer('reviewer-code', 'S2')], 'no builder while ux works');
  w.put('step_claimed', { step_id: ux });
  w.put('step_reported', { step_id: ux, output: { status: 'APPROVE' } });
  w.put('step_verified', { step_id: ux, evidence: [], verdict: 'APPROVE' });
  assert.deepEqual(due(w.s, IN), [BUILDER, reviewer('reviewer-code', 'S2')]);
});

test('rerun DESIGN past gate 1 (3-4): the designer, gate 1 and its card are voided; a fresh designer is due, then a new gate_1 card', () => {
  const w = toSpecDesign();
  const d = w.issue(DESIGNER);
  w.finish(d, designOut());
  specLinted(w);
  const [g] = due(w.s, IN);
  assert.equal(g.card?.type, 'gate_1');
  const gid = w.issue(g);
  w.put('step_claimed', { step_id: gid });
  w.put('gate_1_passed', { prompt_fact_id: 'f' }, { actor: 'human' });
  w.put('step_verified', { step_id: gid, evidence: [] });
  assert.equal(w.s.phase, 'SLICE_PLAN');
  const voids = rerunVoids(w.s, w.log, 'DESIGN');
  assert.ok(voids.includes(d) && voids.includes(gid), JSON.stringify(voids));
  w.put('stage_rerun_requested', { prompt_fact_id: 'f', stage: 'DESIGN', voids }, { actor: 'human' });
  assert.equal(w.s.phase, 'SPEC_DESIGN');
  assert.deepEqual(due(w.s, IN), [{ ...DESIGNER, attempt: 2 }], 'the spec stands; a fresh designer, no gate card yet');
  const d2 = w.issue({ ...DESIGNER, attempt: 2 });
  w.finish(d2, designOut());
  const [g2] = due(w.s, IN);
  assert.deepEqual([g2.card?.type, g2.card?.title], ['gate_1', 'Gate 1 — Spec + Design ready']);
});
