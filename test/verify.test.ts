import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AnyEvent } from '../src/core/events.ts';
import { apply, fold, type RunState, type Step } from '../src/core/reducer.ts';
import {
  agentEvidence, classifyOrphan, closeEvidence, designerRequired, designMode, designQuestionAnswered, dueReviewers, gateEvidence, isVerified, latestDesign, latestSlicePlan, latestSpec,
  mergeEvidence, readyDesign, reworkVoids, roundFailure, roundNext, roundOf, sliceReworkVoids, sliceVerdicts, uiReference,
  evidenceState, isParked, latestByRole, liveSlices, rerunVoids, sliceDeps, wantsBuilder,
} from '../src/core/verify.ts';
import { readLines } from '../src/store/jsonl.ts';
import { join } from 'node:path';

let n = 0;
const fact = (kind: string, data: object, ts = '2026-10-24T10:00:00.000Z'): AnyEvent => ({ v: 1, id: `F${++n}`, ts, run: 'r', session: 'S', kind, actor: 'hook', corr: null, data } as AnyEvent);
const step = (o: Partial<Step> = {}): Step => ({ id: 'ST', kind: 'spawn', stage: 'RECON', attempt: 1, state: 'reported', role: 'recon', agent: 'd2t-factory:recon', output_path: '/h/steps/ST/out.md', issued_seq: 3, ...o });
const OUT = '/real/h/steps/ST/out.md';

test('agent evidence: output_written at the realpath → its agent_id → subagent_stopped of that agent', () => {
  const w = fact('output_written', { path: OUT, agent_id: 'a1' });
  const s = fact('subagent_stopped', { agent_id: 'a1', agent_type: 'd2t-factory:recon' });
  assert.deepEqual(agentEvidence(step(), [w, s], { output: OUT }), { ok: true, evidence: [w.id, s.id], agent_id: 'a1' });
  assert.deepEqual(agentEvidence(step(), [s], { output: OUT }), { ok: false, reason: `no output_written for ${OUT}`, stopped: false });
  assert.deepEqual(agentEvidence(step(), [w], { output: OUT }), { ok: false, reason: 'no subagent_stopped for agent a1', stopped: false });
  // Another path, another agent, or a contradicting agent_type is not evidence.
  assert.equal(agentEvidence(step(), [fact('output_written', { path: '/other', agent_id: 'a1' }), s], { output: OUT }).ok, false);
  assert.equal(agentEvidence(step(), [w, fact('subagent_stopped', { agent_id: 'a2' })], { output: OUT }).ok, false);
  assert.equal(agentEvidence(step(), [w, fact('subagent_stopped', { agent_id: 'a1', agent_type: 'd2t-factory:builder' })], { output: OUT }).ok, false);
  assert.equal(agentEvidence(step(), [fact('output_written', { path: OUT }), s], { output: OUT }).ok, false, 'a main-session write has no agent');
});

test('stopped: by the output agent, the claimed agent_id, or the agent type at or after the claim', () => {
  const s = fact('subagent_stopped', { agent_id: 'a9', agent_type: 'd2t-factory:recon' }, '2026-10-24T10:05:00.000Z');
  assert.equal((agentEvidence(step({ agent_id: 'a9' }), [s], { output: OUT }) as { stopped: boolean }).stopped, true);
  assert.equal((agentEvidence(step(), [s], { output: OUT, claimed_ts: '2026-10-24T10:01:00.000Z' }) as { stopped: boolean }).stopped, true);
  assert.equal((agentEvidence(step(), [s], { output: OUT, claimed_ts: '2026-10-24T10:06:00.000Z' }) as { stopped: boolean }).stopped, false, 'a stop before the claim');
  assert.equal((agentEvidence(step(), [s], { output: OUT }) as { stopped: boolean }).stopped, false);
});

test('orphans: complete evidence verifies, a stop without a parseable output reissues, a running agent waits', () => {
  const okEv = { ok: true as const, evidence: ['x'], agent_id: 'a' };
  assert.equal(classifyOrphan(step({ state: 'claimed' }), { parsed: true, evidence: okEv }), 'verify');
  assert.equal(classifyOrphan(step({ state: 'claimed' }), { parsed: false, evidence: okEv }), 'reissue');
  assert.equal(classifyOrphan(step({ state: 'claimed' }), { parsed: false, evidence: { ok: false, reason: 'r', stopped: true } }), 'reissue');
  assert.equal(classifyOrphan(step({ state: 'claimed' }), { parsed: true, evidence: { ok: false, reason: 'r', stopped: false } }), 'wait');
  assert.equal(classifyOrphan(step({ kind: 'run_check', state: 'claimed' }), { parsed: false }), 'reissue');
  assert.equal(classifyOrphan(step({ kind: 'enter_worktree', state: 'claimed' }), { parsed: false }), 'reissue');
  assert.equal(classifyOrphan(step({ kind: 'ask_human', state: 'claimed' }), { parsed: false }), 'wait');
});

// SPEC_DESIGN with one verified spec step whose output sha256 is `sha`.
function specState(sha = 'd1'): { s: RunState; put: (kind: string, data: object, extra?: object) => string } {
  let i = 0;
  let s = fold([{ v: 1, id: 'A', ts: 't', run: 'r', kind: 'run_started', actor: 'cli', corr: '', data: { task: 't', repo_hash: 'h', base_sha: 'b', branch: 'x' } } as AnyEvent]);
  const put = (kind: string, data: object, extra: object = {}): string => {
    const id = `C${++i}`;
    const r = apply(s, { v: 1, id, ts: 't', run: 'r', session: 'S', kind, actor: 'cli', corr: '', data, ...extra } as AnyEvent);
    assert.ok(r.ok, r.reason);
    s = r.state;
    return id;
  };
  put('intake_confirmed', { prompt_fact_id: 'f' }, { actor: 'human' });
  put('stage_completed', { stage: 'RECON' });
  put('step_issued', { kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder' });
  put('step_claimed', { step_id: 'C3' });
  put('step_verified', { step_id: 'C3', evidence: [] });
  const sw = put('step_issued', { kind: 'spawn', stage: 'SPEC', attempt: 1, role: 'spec-writer', output_path: '/p/out.md' });
  put('step_claimed', { step_id: sw });
  put('step_reported', { step_id: sw, output: { status: 'DONE', sha256: sha, front: {} } });
  put('step_verified', { step_id: sw, evidence: [] });
  return { get s() { return s; }, put } as never;
}

test('gate 1 evidence: a passing, unvoided spec.lint of exactly the verified spec bytes', () => {
  const w = specState();
  assert.deepEqual(gateEvidence(w.s, 'gate1'), { ok: false, reason: 'no passing spec.lint newer than the verified spec C6' });
  w.put('check_ran', { check: 'spec.lint', exit_code: 1, duration_ms: 1, basis_seq: 1, digest: 'd1' });
  assert.equal(gateEvidence(w.s, 'gate1').ok, false, 'failing');
  w.put('check_ran', { check: 'spec.lint', exit_code: 0, duration_ms: 1, basis_seq: 1, digest: 'other' });
  assert.equal(gateEvidence(w.s, 'gate1').ok, false, 'another spec');
  const lint = w.put('check_ran', { check: 'spec.lint', exit_code: 0, duration_ms: 1, basis_seq: 1, digest: 'd1' });
  const g = gateEvidence(w.s, 'gate1');
  assert.ok(g.ok);
  assert.deepEqual(g.evidence, [lint, 'C6']);
  // gate 2 also needs a plan.lint of the current plan.
  assert.deepEqual(gateEvidence(w.s, 'gate2', { planDigest: 'p1' }), { ok: false, reason: 'no passing plan.lint of the current plan' });
  w.put('check_ran', { check: 'plan.lint', exit_code: 0, duration_ms: 1, basis_seq: 1, digest: 'p1' });
  assert.ok(gateEvidence(w.s, 'gate2', { planDigest: 'p1' }).ok);
  assert.equal(gateEvidence(w.s, 'gate2', { planDigest: 'p2' }).ok, false, 'the plan changed since it was linted');
  assert.equal(gateEvidence(w.s, 'gate2').ok, false);
});

test('a gate-1 rework voids the spec step, its step_verified and its spec.lint; voided means absent', () => {
  const w = specState();
  const lint = w.put('check_ran', { check: 'spec.lint', exit_code: 0, duration_ms: 1, basis_seq: 1, digest: 'd1' });
  const commands = [{ id: 'C9', kind: 'step_verified', data: { step_id: 'C6', evidence: [] } }] as unknown as AnyEvent[];
  const voids = reworkVoids(w.s, commands, 'gate1');
  assert.deepEqual(voids, ['C6', 'C9', lint]);
  w.put('rework_requested', { prompt_fact_id: 'f', target: 'gate1', note: 'n', voids }, { actor: 'human' });
  assert.equal(isVerified(w.s, w.s.steps.C6), false);
  assert.equal(latestSpec(w.s), undefined);
  assert.equal(gateEvidence(w.s, 'gate1').ok, false);
  assert.deepEqual(reworkVoids(w.s, commands, 'gate1'), [], 'nothing left to void');
  const pl = w.put('check_ran', { check: 'plan.lint', exit_code: 0, duration_ms: 1, basis_seq: 1, digest: 'p' });
  assert.deepEqual(reworkVoids(w.s, commands, 'gate2'), [pl]);
});

// SPEC_DESIGN with a designer required (ui_surface, not UI-free), a verified spec C9 and a passing lint.
function designState(o: { origin?: string } = {}) {
  let i = 0;
  let s = fold([{ v: 1, id: 'A', ts: 't', run: 'r', kind: 'run_started', actor: 'cli', corr: '', data: { task: 't', repo_hash: 'h', base_sha: 'b', branch: 'x' } } as AnyEvent]);
  const put = (kind: string, data: object, extra: object = {}): string => {
    const id = `D${++i}`;
    const r = apply(s, { v: 1, id, ts: 't', run: 'r', session: 'S', kind, actor: 'cli', corr: '', data, ...extra } as AnyEvent);
    assert.ok(r.ok, r.reason);
    s = r.state;
    return id;
  };
  const finish = (id: string, output?: object): string => {
    put('step_claimed', { step_id: id });
    if (output) put('step_reported', { step_id: id, output });
    return put('step_verified', { step_id: id, evidence: [] });
  };
  put('intake_confirmed', { prompt_fact_id: 'f', intake: { limit_min: 120, slice_timebox_min: 30, ui_free: false, reviewer_overrides: { add: [], remove: [] } } }, { actor: 'human' });
  put('stage_completed', { stage: 'RECON', recon: { path: '/c', sha256: 'c', context: { origin: o.origin ?? 'brownfield', ui_surface: true } } });
  finish(put('step_issued', { kind: 'spawn', stage: 'SCAFFOLD', attempt: 1, role: 'scaffolder' }));
  const spec = put('step_issued', { kind: 'spawn', stage: 'SPEC', attempt: 1, role: 'spec-writer', output_path: '/p/spec.md' });
  finish(spec, { status: 'DONE', sha256: 'd1', front: {} });
  const lint = put('check_ran', { check: 'spec.lint', exit_code: 0, duration_ms: 1, basis_seq: 1, digest: 'd1' });
  return { get s() { return s; }, put, finish, spec, lint };
}

test('the designer: required iff ui_surface and the intake is not UI-free; inherit for brownfield, invent otherwise', () => {
  const w = designState();
  assert.equal(designerRequired(w.s), true);
  assert.equal(designMode(w.s), 'inherit');
  assert.equal(designMode(designState({ origin: 'greenfield' }).s), 'invent');
  assert.equal(designerRequired({ ...w.s, intake: { ...w.s.intake!, ui_free: true } }), false);
  assert.equal(designerRequired({ ...w.s, intake: undefined }), false, 'no intake fields: no designer');
  assert.equal(designerRequired({ ...w.s, recon: { ...w.s.recon!, context: { origin: 'brownfield', ui_surface: false } } }), false);
  assert.equal(designerRequired(specState().s), false);
});

test('gate 1 with a designer needs the ready design (verified, unvoided, its question answered) and returns it; a rework voids it with the spec', () => {
  const w = designState();
  assert.deepEqual(gateEvidence(w.s, 'gate1'), { ok: false, reason: 'no verified design with its question answered' });
  const d = w.put('step_issued', { kind: 'spawn', stage: 'DESIGN', attempt: 1, role: 'designer', output_path: '/p/design.md' });
  w.put('step_claimed', { step_id: d });
  w.put('step_reported', { step_id: d, output: { status: 'DONE', sha256: 'dd', front: { mode: 'invent' }, question: { question: 'q', a: 'x', b: 'y', default: 'a' } } });
  assert.equal(gateEvidence(w.s, 'gate1').ok, false, 'reported, not verified');
  const dv = w.put('step_verified', { step_id: d, evidence: [] });
  assert.equal(latestDesign(w.s)?.id, d);
  assert.equal(readyDesign(w.s), undefined, 'its question is open');
  assert.equal(gateEvidence(w.s, 'gate1').ok, false);
  const card = w.put('step_issued', { kind: 'ask_human', stage: 'DESIGN', attempt: 1, card: { type: 'design_choice', title: 'Design question — q', commands: [] } });
  assert.equal(designQuestionAnswered(w.s), false);
  w.put('design_choice_made', { prompt_fact_id: 'f', choice: 'a' }, { actor: 'human' });
  w.finish(card);
  assert.equal(designQuestionAnswered(w.s), true);
  const g = gateEvidence(w.s, 'gate1');
  assert.ok(g.ok);
  assert.deepEqual([g.evidence, g.design?.id], [[w.lint, w.spec, d], d]);
  const commands = [{ id: dv, kind: 'step_verified', data: { step_id: d, evidence: [] } }] as unknown as AnyEvent[];
  const voids = reworkVoids(w.s, commands, 'gate1');
  assert.deepEqual(voids.slice(-2), [d, dv]);
  assert.ok(voids.includes(w.spec) && voids.includes(w.lint));
  w.put('rework_requested', { prompt_fact_id: 'f', target: 'gate1', note: 'n', voids }, { actor: 'human' });
  assert.deepEqual([latestDesign(w.s), readyDesign(w.s)], [undefined, undefined]);
});

test('a resumed agent keeps its agent_id: only a stop at or after the claim verifies the new round', () => {
  const claim = '2026-10-24T10:05:00.000Z';
  const st = step({ kind: 'resume', agent_id: 'a1', role: 'builder', agent: 'd2t-factory:builder' });
  const w = fact('output_written', { path: OUT, agent_id: 'a1' }, '2026-10-24T10:06:00.000Z');
  const old = fact('subagent_stopped', { agent_id: 'a1', agent_type: 'd2t-factory:builder' }, '2026-10-24T10:00:00.000Z');
  const ev = agentEvidence(st, [old, w], { output: OUT, claimed_ts: claim });
  assert.deepEqual(ev, { ok: false, reason: 'no subagent_stopped for agent a1', stopped: false }, "round 1's stop is not round 2's");
  const fresh = fact('subagent_stopped', { agent_id: 'a1', agent_type: 'd2t-factory:builder' }, '2026-10-24T10:07:00.000Z');
  assert.deepEqual(agentEvidence(st, [old, w, fresh], { output: OUT, claimed_ts: claim }), { ok: true, evidence: [w.id, fresh.id], agent_id: 'a1' });
  assert.equal(classifyOrphan(step({ kind: 'exit_worktree', state: 'claimed' }), { parsed: false }), 'reissue');
});

// BUILD → one approved round → closed → WRAP with passing health/test at `h1` and a baseline.
function wrapState() {
  const w = specState();
  w.put('gate_1_passed', { prompt_fact_id: 'f' }, { actor: 'human' });
  w.put('gate_2_passed', { prompt_fact_id: 'f', slices: [{ id: 'S1', title: 't' }] }, { actor: 'human' });
  w.put('slice_started', { slice: 'S1' });
  const done = (data: object, out: object, extra: { sha?: string; verdict?: string } = {}): string => {
    const id = w.put('step_issued', data);
    w.put('step_claimed', { step_id: id });
    w.put('step_reported', { step_id: id, output: out, ...(extra.sha ? { sha: extra.sha } : {}) });
    w.put('step_verified', { step_id: id, evidence: [], ...(extra.verdict ? { verdict: extra.verdict } : {}) });
    return id;
  };
  const check = (stage: string, check: string, sha: string, exit_code = 0): string => {
    const ck = w.put('check_ran', { check, exit_code, duration_ms: 1, basis_seq: 1, sha });
    done({ kind: 'run_check', stage, attempt: 1, check, ...(stage === 'BUILD' ? { slice: 'S1' } : {}) }, { check_id: ck, exit_code });
    return ck;
  };
  done({ kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'builder', slice: 'S1' }, { status: 'DONE' }, { sha: 'c1' });
  assert.deepEqual(closeEvidence(w.s, 'S1'), { ok: false, reason: 'no passing contract.test after the last builder commit' });
  const test = check('BUILD', 'contract.test', 'c1');
  assert.deepEqual(closeEvidence(w.s, 'S1'), { ok: false, reason: 'no reviewer-code APPROVE' });
  done({ kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'reviewer-code', slice: 'S1' }, { status: 'APPROVE' }, { verdict: 'APPROVE' });
  const ce = closeEvidence(w.s, 'S1');
  assert.ok(ce.ok && ce.check.id === test && ce.builder.sha === 'c1');
  const closed = w.put('slice_closed', { slice: 'S1', check_id: test });
  w.put('stage_completed', { stage: 'BUILD' });
  const health = check('WRAP', 'contract.health', 'h1');
  const wtest = check('WRAP', 'contract.test', 'h1');
  return { w, closed, health, wtest };
}

test('merge evidence: an open card offering the merge, pinned to the head and target, with passing WRAP health/test at that head and a later baseline', () => {
  const { w, health, wtest } = wrapState();
  const at = { head: 'h1', target: 't1' };
  assert.deepEqual(mergeEvidence(w.s, at), { ok: false, reason: 'no open merge card' });
  const card = (commands: string[], sha = 'h1', target: string | null = 't1') =>
    w.put('step_issued', { kind: 'ask_human', stage: 'WRAP', attempt: 1, card: { type: 'merge', title: 'm', reason: 'r', commands, sha, target } });
  const blocked = card(['/factory abandon']);
  assert.match((mergeEvidence(w.s, at) as { reason: string }).reason, /offers no merge/);
  w.put('step_claimed', { step_id: blocked });
  w.put('step_verified', { step_id: blocked, evidence: [] });
  const id = card(['/factory merge', '/factory abandon']);
  assert.match((mergeEvidence(w.s, { head: 'h2', target: 't1' }) as { reason: string }).reason, /run branch moved/);
  assert.match((mergeEvidence(w.s, { head: 'h1', target: 't2' }) as { reason: string }).reason, /target moved/);
  assert.deepEqual(mergeEvidence(w.s, at), { ok: false, reason: 'no passing git.baseline at the run branch head' });
  w.put('check_ran', { check: 'git.baseline', exit_code: 1, duration_ms: 1, basis_seq: 1, sha: 'h1' });
  assert.equal(mergeEvidence(w.s, at).ok, false, 'a failing baseline');
  const base = w.put('check_ran', { check: 'git.baseline', exit_code: 0, duration_ms: 1, basis_seq: 1, sha: 'h1' });
  const ev = mergeEvidence(w.s, at);
  assert.ok(ev.ok);
  assert.deepEqual([ev.card.id, ev.evidence], [id, [health, wtest, base]]);
});

test('rework S1 at the merge card voids the slice close and every WRAP check since BUILD completed', () => {
  const { w, closed, health, wtest } = wrapState();
  const base = w.put('check_ran', { check: 'git.baseline', exit_code: 0, duration_ms: 1, basis_seq: 1, sha: 'h1' });
  const commands = [
    { id: 'X0', kind: 'slice_closed', data: { slice: 'S1' } }, { id: 'X1', kind: 'stage_completed', data: { stage: 'BUILD' } },
    { id: health, kind: 'check_ran', data: { check: 'contract.health' } }, { id: wtest, kind: 'check_ran', data: { check: 'contract.test' } },
    { id: base, kind: 'check_ran', data: { check: 'git.baseline' } }, { id: 'X2', kind: 'check_ran', data: { check: 'git.deps' } },
  ] as unknown as AnyEvent[];
  const steps = w.s.step_order.filter((id) => w.s.steps[id].kind === 'run_check' && w.s.steps[id].stage === 'WRAP');
  assert.equal(steps.length, 2);
  const voids = sliceReworkVoids(w.s, commands, 'S1');
  assert.deepEqual(voids, ['X0', ...steps, health, wtest, base]);
  assert.ok(closed);
  w.put('rework_requested', { prompt_fact_id: 'f', target: 'S1', note: 'n', voids }, { actor: 'human' });
  assert.deepEqual([w.s.phase, w.s.slices.S1.state], ['BUILD', 'BUILDING']);
  assert.deepEqual(sliceReworkVoids(w.s, commands, 'S1'), [], 'nothing left to void');
});

// --- 3-3: the slicer, the roster in a round, close per role -------------------------------------

test('a gate-2 rework voids the current slicer step, its step_verified and the unvoided plan.lint checks', () => {
  const w = specState();
  w.put('gate_1_passed', { prompt_fact_id: 'f' }, { actor: 'human' });
  const sl = w.put('step_issued', { kind: 'spawn', stage: 'SLICE_PLAN', attempt: 1, role: 'slicer', output_path: '/p/plan.md' });
  w.put('step_claimed', { step_id: sl });
  w.put('step_reported', { step_id: sl, output: { status: 'DONE', front: { slices: [] } } });
  const sv = w.put('step_verified', { step_id: sl, evidence: [] });
  assert.equal(latestSlicePlan(w.s)?.id, sl);
  const pl = w.put('check_ran', { check: 'plan.lint', exit_code: 0, duration_ms: 1, basis_seq: 1, digest: 'p' });
  const commands = [{ id: sv, kind: 'step_verified', data: { step_id: sl, evidence: [] } }] as unknown as AnyEvent[];
  const voids = reworkVoids(w.s, commands, 'gate2');
  assert.deepEqual(voids, [sl, sv, pl]);
  w.put('rework_requested', { prompt_fact_id: 'f', target: 'gate2', note: 'n', voids }, { actor: 'human' });
  assert.equal(latestSlicePlan(w.s), undefined, 'voided means absent');
  assert.deepEqual(reworkVoids(w.s, commands, 'gate2'), []);
});

test('uiReference: the current design, else RECON\'s ui_reference, else none', () => {
  const w = specState();
  assert.equal(uiReference(w.s), undefined);
  const withRef = { ...w.s, recon: { path: '/c', sha256: 'c', context: { ui_reference: 'src/components' } } };
  assert.equal(uiReference(withRef), 'src/components');
  const d = w.put('step_issued', { kind: 'spawn', stage: 'DESIGN', attempt: 1, role: 'designer', output_path: '/p/design.md' });
  w.put('step_claimed', { step_id: d });
  w.put('step_reported', { step_id: d, output: { status: 'DONE', front: {}, path: '/p/design.md' } });
  w.put('step_verified', { step_id: d, evidence: [] });
  assert.equal(uiReference({ ...w.s, recon: withRef.recon }), '/p/design.md');
});

// BUILD with S1 rostered [code, security, ux] (gate 2 passed, slice started).
function rosterState(roster = ['reviewer-code', 'reviewer-security', 'reviewer-ux']) {
  const w = specState();
  w.put('gate_1_passed', { prompt_fact_id: 'f' }, { actor: 'human' });
  w.put('gate_2_passed', { prompt_fact_id: 'f', slices: [{ id: 'S1', title: 't', tags: ['ui', 'input'], roster }] }, { actor: 'human' });
  w.put('slice_started', { slice: 'S1' });
  const done = (data: object, out: object, extra: { sha?: string; verdict?: string } = {}): string => {
    const id = w.put('step_issued', data);
    w.put('step_claimed', { step_id: id });
    w.put('step_reported', { step_id: id, output: out, ...(extra.sha ? { sha: extra.sha } : {}) });
    w.put('step_verified', { step_id: id, evidence: [], ...(extra.verdict ? { verdict: extra.verdict } : {}) });
    return id;
  };
  const check = (check: string, sha: string, exit_code = 0, stage = 'BUILD'): string => {
    const ck = w.put('check_ran', { check, exit_code, duration_ms: 1, basis_seq: 1, sha });
    return done({ kind: 'run_check', stage, attempt: 1, check, ...(stage === 'BUILD' ? { slice: 'S1' } : {}) }, { check_id: ck, exit_code });
  };
  const builder = (sha: string): string => done({ kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'builder', slice: 'S1' }, { status: 'DONE' }, { sha });
  const review = (role: string, verdict: string): string => done({ kind: 'spawn', stage: 'BUILD', attempt: 1, role, slice: 'S1' }, { status: verdict, findings: verdict === 'FINDINGS' ? [{}] : [] }, { verdict });
  return { w, check, builder, review };
}

test('the round (3-3): the full roster first; health only with a running-app reviewer due; the round fails only once settled, with every reviewer at FINDINGS; then only those re-check', () => {
  const { w, check, builder, review } = rosterState();
  assert.deepEqual(dueReviewers(w.s, 'S1'), ['reviewer-code', 'reviewer-security', 'reviewer-ux'], 'no reviewer ran: the full roster');
  builder('c1');
  const t1 = check('contract.test', 'c1');
  let r = roundOf(w.s, 'S1');
  assert.deepEqual([r.test?.id, r.due], [t1, ['reviewer-code', 'reviewer-security', 'reviewer-ux']]);
  assert.deepEqual(roundNext(w.s, r), { reviewers: ['reviewer-code', 'reviewer-security'], health: true });
  review('reviewer-code', 'FINDINGS');
  review('reviewer-security', 'APPROVE');
  r = roundOf(w.s, 'S1');
  assert.deepEqual(roundNext(w.s, r), { reviewers: [], health: true });
  assert.equal(roundFailure(w.s, r), null, 'not settled: health and ux are still due');
  assert.deepEqual(closeEvidence(w.s, 'S1'), { ok: false, reason: 'slice S1 is FINDINGS_QUEUED' });
  check('contract.health', 'c1');
  r = roundOf(w.s, 'S1');
  assert.deepEqual(roundNext(w.s, r), { reviewers: ['reviewer-ux'], health: false }, 'health passed: the running-app reviewer');
  const ux = review('reviewer-ux', 'FINDINGS');
  r = roundOf(w.s, 'S1');
  const f = roundFailure(w.s, r);
  assert.deepEqual([f?.kind, f?.findings.map((x) => x.role)], ['findings', ['reviewer-code', 'reviewer-ux']]);
  // Round 2: only the raising reviewers, ux again behind health.
  builder('c2');
  check('contract.test', 'c2');
  r = roundOf(w.s, 'S1');
  assert.deepEqual(r.due, ['reviewer-code', 'reviewer-ux']);
  assert.deepEqual(roundNext(w.s, r), { reviewers: ['reviewer-code'], health: true });
  // A failing health check: the round fails on health once code reported, carrying code's findings.
  check('contract.health', 'c2', 1);
  assert.equal(roundFailure(w.s, roundOf(w.s, 'S1')), null, 'reviewer-code not issued yet');
  review('reviewer-code', 'FINDINGS');
  const hf = roundFailure(w.s, roundOf(w.s, 'S1'));
  assert.deepEqual([hf?.kind, hf?.findings.map((x) => x.role)], ['health', ['reviewer-code']]);
  // Round 3: code and ux (whose latest verdict is still FINDINGS); both approve, then the close.
  builder('c3');
  check('contract.test', 'c3');
  assert.deepEqual(roundOf(w.s, 'S1').due, ['reviewer-code', 'reviewer-ux']);
  review('reviewer-code', 'APPROVE');
  assert.deepEqual(closeEvidence(w.s, 'S1'), { ok: false, reason: 'no reviewer-ux APPROVE' });
  check('contract.health', 'c3');
  const ux2 = review('reviewer-ux', 'APPROVE');
  assert.equal(roundFailure(w.s, roundOf(w.s, 'S1')), null);
  const ce = closeEvidence(w.s, 'S1');
  assert.ok(ce.ok && ce.builder.sha === 'c3');
  assert.deepEqual(sliceVerdicts(w.s, 'S1').map((v) => [v.role, v.step?.verdict]), [['reviewer-code', 'APPROVE'], ['reviewer-security', 'APPROVE'], ['reviewer-ux', 'APPROVE']]);
  assert.notEqual(ux, ux2);
});

test('the round (3-3): after every reviewer approved, a builder round no finding asked for (a New dependency retry) and the first round after a rework review with the full roster again', () => {
  const { w, check, builder, review } = rosterState(['reviewer-code', 'reviewer-security']);
  builder('c1');
  check('contract.test', 'c1');
  review('reviewer-code', 'APPROVE');
  review('reviewer-security', 'APPROVE');
  assert.ok(closeEvidence(w.s, 'S1').ok);
  // A New dependency retry: another builder commit, then the full roster, and no close before it.
  w.put('ask_raised', { card: { type: 'escalation', title: 'New dependency (S1)', commands: [] }, slice: 'S1', escalation: 'E1' });
  w.put('escalation_ruled', { prompt_fact_id: 'f', escalation: 'E1', choice: 'retry', slice_to: 'BUILDING' }, { actor: 'human' });
  builder('c2');
  check('contract.test', 'c2');
  assert.deepEqual(roundOf(w.s, 'S1').due, ['reviewer-code', 'reviewer-security']);
  assert.deepEqual(closeEvidence(w.s, 'S1'), { ok: false, reason: 'no reviewer-code APPROVE' });
  review('reviewer-code', 'APPROVE');
  review('reviewer-security', 'FINDINGS');
  builder('c3');
  check('contract.test', 'c3');
  assert.deepEqual(roundOf(w.s, 'S1').due, ['reviewer-security']);
  const t = review('reviewer-security', 'APPROVE');
  const ce = closeEvidence(w.s, 'S1');
  assert.ok(ce.ok);
  // Close, WRAP, and a rework of S1 from the merge card: the full roster again.
  w.put('slice_closed', { slice: 'S1', check_id: ce.check.id });
  w.put('stage_completed', { stage: 'BUILD' });
  check('contract.health', 'h1', 0, 'WRAP');
  w.put('rework_requested', { prompt_fact_id: 'f', target: 'S1', note: 'n', voids: [] }, { actor: 'human' });
  assert.deepEqual(dueReviewers(w.s, 'S1'), ['reviewer-code', 'reviewer-security'], 'nothing reviewed since the rework');
  builder('c4');
  check('contract.test', 'c4');
  assert.deepEqual(roundOf(w.s, 'S1').due, ['reviewer-code', 'reviewer-security']);
  assert.deepEqual(closeEvidence(w.s, 'S1'), { ok: false, reason: 'no reviewer-code APPROVE' }, "the approvals from before the rework don't count");
  assert.ok(t);
});

// --- 3-4 ------------------------------------------------------------------------------------------

test('evidenceState (3-4): BUILDING while its builder is open; work that finished while ESCALATED counts (IN_REVIEW, FINDINGS_QUEUED); a retry waiting for its builder stays BUILDING', () => {
  const { w, check, builder, review } = rosterState(['reviewer-code']);
  const b = w.put('step_issued', { kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'builder', slice: 'S1' });
  w.put('step_claimed', { step_id: b });
  assert.deepEqual([wantsBuilder(w.s, 'S1'), liveSlices(w.s).map((x) => x.id)], [false, ['S1']]);
  w.put('ask_raised', { card: { type: 'escalation', title: 'x', reason_label: 'Over time box', commands: [] }, slice: 'S1', escalation: 'E1' });
  assert.equal(evidenceState(w.s, 'S1'), 'BUILDING');
  w.put('step_reported', { step_id: b, sha: 'c1', output: { status: 'DONE' } });
  w.put('step_verified', { step_id: b, evidence: [] });
  assert.deepEqual([w.s.slices.S1.state, evidenceState(w.s, 'S1')], ['ESCALATED', 'IN_REVIEW'], 'the builder finished while escalated');
  w.put('escalation_ruled', { prompt_fact_id: 'f', escalation: 'E1', choice: 'retry', slice_to: 'IN_REVIEW' }, { actor: 'human' });
  check('contract.test', 'c1');
  w.put('ask_raised', { card: { type: 'escalation', title: 'x', commands: [] }, slice: 'S1', escalation: 'E2' });
  review('reviewer-code', 'FINDINGS');
  assert.equal(evidenceState(w.s, 'S1'), 'FINDINGS_QUEUED', 'a FINDINGS that arrived while escalated');
  w.put('escalation_ruled', { prompt_fact_id: 'f', escalation: 'E2', choice: 'retry', slice_to: 'FINDINGS_QUEUED' }, { actor: 'human' });
  assert.equal(wantsBuilder(w.s, 'S1'), true, 'a failed round under the cap wants its builder');
  // A Non-convergence retry (slice_to BUILDING), escalated again before its builder was issued.
  w.put('ask_raised', { card: { type: 'escalation', title: 'nc', reason_label: 'Non-convergence', commands: [] }, slice: 'S1', escalation: 'E3' });
  w.put('escalation_ruled', { prompt_fact_id: 'f', escalation: 'E3', choice: 'retry', slice_to: 'BUILDING' }, { actor: 'human' });
  w.put('ask_raised', { card: { type: 'escalation', title: 'tb', reason_label: 'Over time box', commands: [] }, slice: 'S1', escalation: 'E4' });
  assert.equal(evidenceState(w.s, 'S1'), 'BUILDING');
  assert.ok(builder);
});

test('sliceDeps (3-4): only the slice\'s own verified, unvoided builder commits, oldest first; latestStep skips a cancelled step', () => {
  const { w, builder } = rosterState(['reviewer-code']);
  builder('c1');
  const b2 = w.put('step_issued', { kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'builder', slice: 'S1' });
  w.put('step_claimed', { step_id: b2 });
  assert.equal(latestByRole(w.s, 'builder')?.id, b2);
  w.put('step_cancelled', { step_id: b2, reason: 'voided' });
  assert.notEqual(latestByRole(w.s, 'builder')?.id, b2, 'a cancelled step is never the latest');
  builder('c3');
  assert.deepEqual(sliceDeps(w.s, 'S1'), ['c1', 'c3']);
  assert.deepEqual(sliceDeps(w.s, 'S2'), []);
});

const FIX = join(import.meta.dirname, 'fixtures');
const happy = (): AnyEvent[] => readLines<AnyEvent>(join(FIX, 'happy-path.jsonl')).items;

test('rerunVoids (3-4): the stage\'s steps, verifies and lint checks, every later gate pass and stage step, every slice step and slice_closed; RECON keeps SCAFFOLD', () => {
  const all = happy();
  const cmds = all.slice(0, all.findIndex((e) => e.kind === 'merge_approved') + 1); // WRAP, merge approved
  const s = fold(cmds);
  const id = (x: string): string => `01JQ00000000000000000000${x}`;
  const plan = rerunVoids(s, cmds, 'SLICE_PLAN');
  assert.deepEqual(plan, [
    id('0J'), id('0N'), // the slicer and its step_verified
    id('0S'), id('0W'), id('0X'), id('10'), // S1's builder and reviewer, with their step_verified
    id('0P'), // plan.lint
    id('0Q'), id('12'), id('14'), // gate_2_passed, slice_closed, merge_approved
  ]);
  const spec = rerunVoids(s, cmds, 'SPEC');
  for (const x of ['0C', '0F', '0G', '0H', '0J', '0P', '0Q', '12']) assert.ok(spec.includes(id(x)), `SPEC voids ${x}`);
  const recon = rerunVoids(s, cmds, 'RECON');
  for (const x of ['04', '08', '0B']) assert.ok(!recon.includes(id(x)), `RECON keeps SCAFFOLD's ${x}`);
  assert.ok(recon.includes(id('0C')) && recon.includes(id('0H')));
  const design = rerunVoids(s, cmds, 'DESIGN');
  assert.ok(!design.includes(id('0C')) && !design.includes(id('0G')) && design.includes(id('0H')), 'DESIGN keeps the spec and its lint, not gate 1');
  // Already voided ids are left out.
  assert.deepEqual(rerunVoids({ ...s, voided: plan }, cmds, 'SLICE_PLAN'), []);
});

test('isParked (3-4): every open step is a card or the subject of an open ask', () => {
  const { w } = rosterState(['reviewer-code']);
  assert.equal(isParked(w.s), false, 'nothing open');
  const b = w.put('step_issued', { kind: 'spawn', stage: 'BUILD', attempt: 1, role: 'builder', slice: 'S1' });
  w.put('step_claimed', { step_id: b });
  assert.equal(isParked(w.s), false, 'an agent at work');
  w.put('step_reported', { step_id: b, output: { status: 'ESCALATE' } });
  w.put('ask_raised', { card: { type: 'escalation', title: 'x', commands: [] }, step_id: b, slice: 'S1', escalation: 'E1' });
  w.put('step_issued', { kind: 'ask_human', stage: 'BUILD', attempt: 1, card: { type: 'escalation', title: 'x', commands: [], escalation: 'E1' } });
  assert.equal(isParked(w.s), true);
});
