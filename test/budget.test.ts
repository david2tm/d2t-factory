// core/budget.ts: the budget clock, the cut gate's candidates and the wait deadline (3-1, AD-17).
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { budgetOf, clockStart, cutCandidates, deadlinesAhead, nextDeadlineMs, openCutAsk, sliceTimebox, timeboxView } from '../src/core/budget.ts';
import type { AnyEvent } from '../src/core/events.ts';
import { CUT_LEAD_MS, WAIT_MAX_MS } from '../src/core/config.ts';
import { initialState, type RunState, type SliceState } from '../src/core/reducer.ts';

const T0 = Date.parse('2026-10-24T12:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();
const MIN = 60_000;

// BUILD with these slices, an intake of `limit` minutes and the clock started at T0.
function state(o: { limit?: number; phase?: RunState['phase']; slices?: Record<string, SliceState>; intake?: boolean } = {}): RunState {
  const s: RunState = { ...initialState(), run_id: 'r', phase: o.phase ?? 'BUILD' };
  if (o.intake !== false) {
    s.intake = { limit_min: o.limit ?? 120, slice_timebox_min: 30, ui_free: false, reviewer_overrides: { add: [], remove: [] } };
    s.clock_start = iso(T0);
  }
  for (const [id, st] of Object.entries(o.slices ?? { S1: 'BUILDING', S2: 'BACKLOG', S3: 'BACKLOG' }) as [string, SliceState][]) {
    s.slices[id] = { id, deps: [], state: st, rounds: 0 };
    s.slice_order.push(id);
  }
  return s;
}

test('clock start: an earlier exercise start wins; a later one, an absent one or one that does not parse leaves the run start', () => {
  const run = '2026-10-24T12:00:00.000Z';
  assert.equal(clockStart(run, '2026-10-24T10:00:00Z'), '2026-10-24T10:00:00.000Z');
  assert.equal(clockStart(run, '2026-10-24T13:00:00.000Z'), run);
  assert.equal(clockStart(run), run);
  assert.equal(clockStart(run, 'nope'), run);
});

test('budgetOf: null without a confirmed intake; else the cut point at limit − CUT_LEAD_MS and the end at the limit', () => {
  assert.equal(budgetOf(state({ intake: false })), null);
  const b = budgetOf(state())!;
  assert.deepEqual(b, { clock_start: iso(T0), limit_min: 120, cut_at: iso(T0 + 80 * MIN), ends_at: iso(T0 + 120 * MIN), cut_ms: T0 + 80 * MIN, ends_ms: T0 + 120 * MIN });
  assert.equal(budgetOf(state({ limit: 90 }))!.cut_at, iso(T0 + 50 * MIN), '1:30 → 0:50');
  assert.equal(budgetOf(state({ limit: 30 }))!.cut_ms, T0 - 10 * MIN, 'a limit under the lead: the cut point is already behind');
  assert.equal(CUT_LEAD_MS, 40 * MIN);
});

test('cut candidates: every Backlog slice once BUILD passes the cut point; nothing before it, outside BUILD, after a decision, while one is open, or with no Backlog', () => {
  const at = T0 + 80 * MIN;
  assert.deepEqual(cutCandidates(state(), at), ['S2', 'S3']);
  assert.deepEqual(cutCandidates(state(), at - 1), []);
  assert.deepEqual(cutCandidates(state({ phase: 'SLICE_PLAN' }), at), []);
  assert.deepEqual(cutCandidates(state({ intake: false }), at), []);
  assert.deepEqual(cutCandidates(state({ slices: { S1: 'CLOSED', S2: 'BUILDING' } }), at), []);
  assert.deepEqual(cutCandidates(state({ slices: { S1: 'BACKLOG', S2: 'BACKLOG' } }), at), ['S1', 'S2'], 'before S1 starts');
  const decided = state();
  decided.cut_decided = true;
  assert.deepEqual(cutCandidates(decided, at), []);
  const open = state();
  open.asks.A = { id: 'A', card: { type: 'cut', title: 'c', commands: [] }, open: true };
  assert.equal(openCutAsk(open)?.id, 'A');
  assert.deepEqual(cutCandidates(open, at), []);
});

test('nextDeadlineMs: the time to the cut point or the earliest claim overdue_at ahead, capped at WAIT_MAX_MS; past deadlines do not count', () => {
  const s = state({ limit: 41 }); // cut at T0 + 1 min
  assert.equal(nextDeadlineMs(s, T0), MIN);
  assert.equal(nextDeadlineMs(s, T0, [iso(T0 + 5000)]), 5000);
  assert.equal(nextDeadlineMs(s, T0, [iso(T0 - 5000), iso(T0 + 2 * MIN)]), MIN);
  assert.equal(nextDeadlineMs(s, T0 + MIN), WAIT_MAX_MS, 'the cut point passed: the CLI raises it now');
  assert.equal(nextDeadlineMs(state({ limit: 600 }), T0), WAIT_MAX_MS);
  assert.equal(nextDeadlineMs(state({ intake: false }), T0), WAIT_MAX_MS, 'no deadline');
  assert.equal(nextDeadlineMs(state({ limit: 41, phase: 'SPEC_DESIGN' }), T0), WAIT_MAX_MS, 'the cut is raised in BUILD only');
  assert.equal(nextDeadlineMs(state({ limit: 41, slices: { S1: 'BUILDING' } }), T0), WAIT_MAX_MS, 'nothing left to cut');
  const decided = state({ limit: 41 });
  decided.cut_decided = true;
  assert.equal(nextDeadlineMs(decided, T0, [iso(T0 + 1234)]), 1234, "after a decision only the claims count");
});

// --- 3-4: the slice time box ---------------------------------------------------------------------

let n = 0;
const ev = (kind: string, data: object, ms: number): AnyEvent => ({ v: 1, id: `E${++n}`, ts: iso(ms), run: 'r', kind, actor: 'cli', corr: 'r', data } as AnyEvent);
const raised = (slice: string, esc: string, label: string, ms: number) => ev('ask_raised', { card: { type: 'escalation', title: label, reason_label: label, commands: [] }, slice, escalation: esc }, ms);
const ruled = (esc: string, choice: string, ms: number) => ev('escalation_ruled', { prompt_fact_id: 'f', escalation: esc, choice }, ms);

test('time box (3-4): wall time since slice_started minus escalated time; 31 min with 5 escalated is 26 (not over), 30 net is over; null without an intake or a start', () => {
  const s = state();
  const start = T0;
  const cmds = [ev('gate_2_passed', { prompt_fact_id: 'f', slices: [] }, start - MIN), ev('slice_started', { slice: 'S2' }, start), raised('S2', 'E1', 'New dependency', start + 10 * MIN), ruled('E1', 'accept', start + 15 * MIN)];
  const at31 = sliceTimebox(s, cmds, 'S2', start + 31 * MIN)!;
  assert.deepEqual(at31, { limit_min: 30, ends_at: iso(start + 35 * MIN), elapsed_ms: 26 * MIN, over: false });
  assert.equal(sliceTimebox(s, cmds, 'S2', start + 35 * MIN)!.over, true, '30 min net');
  assert.equal(sliceTimebox(s, cmds, 'S2', start + 35 * MIN - 1)!.over, false);
  assert.equal(sliceTimebox(s, cmds, 'S1', start + 60 * MIN), null, 'S1 never started in this plan');
  assert.equal(sliceTimebox(state({ intake: false }), cmds, 'S2', start + 60 * MIN), null, 'no intake: no time box');
  // An open escalation pauses it: no end while open, and its time does not count.
  const open = [...cmds, raised('S2', 'E2', 'Spec ambiguity', start + 20 * MIN)];
  assert.deepEqual(sliceTimebox(s, open, 'S2', start + 50 * MIN), { limit_min: 30, ends_at: null, elapsed_ms: 15 * MIN, over: false });
  assert.deepEqual(timeboxView(s, open, 'S2'), { limit_min: 30, ends_at: null });
  assert.deepEqual(timeboxView(s, cmds, 'S2'), { limit_min: 30, ends_at: iso(start + 35 * MIN) });
});

test('time box (3-4): each Over time box ruling grants another full box; a rework from the merge card restarts it; a new plan (gate 2) forgets the old one', () => {
  const s = state();
  const start = T0;
  const base = [ev('gate_2_passed', { prompt_fact_id: 'f', slices: [] }, start), ev('slice_started', { slice: 'S1' }, start)];
  const retried = [...base, raised('S1', 'E1', 'Over time box', start + 30 * MIN), ruled('E1', 'retry go on', start + 40 * MIN)];
  const tb = sliceTimebox(s, retried, 'S1', start + 50 * MIN)!;
  assert.deepEqual([tb.limit_min, tb.elapsed_ms, tb.over, tb.ends_at], [60, 40 * MIN, false, iso(start + 70 * MIN)]);
  assert.equal(sliceTimebox(s, retried, 'S1', start + 70 * MIN)!.over, true, '(k+1) × 30 = 60 min net');
  const reworked = [...base, ev('rework_requested', { prompt_fact_id: 'f', target: 'S1', note: 'n', voids: [] }, start + 90 * MIN)];
  assert.deepEqual(sliceTimebox(s, reworked, 'S1', start + 100 * MIN)!.elapsed_ms, 10 * MIN);
  const replanned = [...retried, ev('gate_2_passed', { prompt_fact_id: 'f', slices: [] }, start + 60 * MIN), ev('slice_started', { slice: 'S1' }, start + 61 * MIN)];
  assert.deepEqual(sliceTimebox(s, replanned, 'S1', start + 62 * MIN)!.limit_min, 30);
});

test('deadlines (3-4): a live slice\'s time box end is a `next --wait` deadline', () => {
  const s = state({ limit: 600 });
  assert.equal(nextDeadlineMs(s, T0, [], [iso(T0 + 7 * MIN)]), 7 * MIN);
  assert.deepEqual(deadlinesAhead(s, T0, [iso(T0 + 9 * MIN)], [iso(T0 - MIN), iso(T0 + 7 * MIN)]), [560 * MIN, 9 * MIN, 7 * MIN], "the cut point, the claim, the time box; a past one is not waited for");
});
