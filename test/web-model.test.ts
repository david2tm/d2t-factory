// The board's pure view logic (src/dashboard/web/src/lib/model.ts), run against real projections:
// lanes are projectRun(fold(...)) over the reducer fixtures, as test/projection.test.ts builds them.
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AnyEvent } from '../src/core/events.ts';
import { projectRun, type Lane as CoreLane } from '../src/core/projection.ts';
import { fold } from '../src/core/reducer.ts';
import { readLines } from '../src/store/jsonl.ts';
import { CLEAR_SAFE_LINE as CORE_CLEAR_SAFE_LINE, gate1Card, signalLostCard } from '../src/core/cards.ts';
import {
  actionRows, activeCardId, CLEAR_SAFE_LINE, agentsAt, ago, displayName, isDroid, roleColor, roleDot, roleLabel, ROSTER, STAGE_AGENT, artifactFor, budgetClock, cells, chipGloss, gateFiles, pinnedLine, proofRow, sealArtifact, shortSha, withBodies, elapsedClock, clockTime, pausedNotice, chipState, counts, doneDeck, emptyCellCopy, needsCell, pendingReviewers, reviewersAtWork, sealLine, sealsOf, shortLabel, stageTrack, stageWord, timeboxMeter, truthCounts, typeTag, upsertLane, verdictText,
} from '../src/dashboard/web/src/lib/model.ts';
import { spriteFor } from '../src/dashboard/web/src/lib/sprites.ts';
import { REVIEWERS } from '../src/core/roster.ts';
import type { BoardCard, Claim, Lane } from '../src/dashboard/web/src/lib/types.ts';

const FIX = join(import.meta.dirname, 'fixtures');
const load = (name: string): AnyEvent[] => readLines<AnyEvent>(join(FIX, `${name}.jsonl`)).items;
const RUN = 'add-login-page-q7k2';

// The browser-side type is a copy of the core one; this keeps them structurally in step.
const asWeb = (l: CoreLane): Lane => l;
const lane = (commands: AnyEvent[], o: { run_id?: string; repo_hash?: string } = {}): Lane =>
  asWeb(projectRun({ state: fold(commands), commands, facts: [], skipped: [] }, { repo_hash: o.repo_hash ?? 'abc123def456', run_id: o.run_id ?? RUN }));
function upTo(events: AnyEvent[], pred: (e: AnyEvent) => boolean): AnyEvent[] {
  const i = events.findIndex(pred);
  assert.ok(i >= 0, 'upTo: no event matches');
  return events.slice(0, i);
}
const at = (ts: string, ms = 0): number => Date.parse(ts) + ms;

const happy = load('happy-path');
const findings = load('findings-escalation-rework');

test('claim chips: claimed until overdue_at, then UNVERIFIED with no server event; verified overrides; superseded wins', () => {
  // The first reported step, before its step_verified.
  const l = lane(upTo(happy, (e) => e.kind === 'step_verified'));
  const claim = l.cards.flatMap((c) => c.claims)[0];
  assert.ok(claim?.overdue_at, 'a reported claim waiting on its hook facts');
  assert.equal(claim.state, 'claimed');
  assert.equal(chipState(claim, at(claim.overdue_at, -1)), 'claimed');
  assert.equal(chipState(claim, at(claim.overdue_at)), 'unverified');
  assert.equal(chipState(claim, at(claim.overdue_at, 3600_000)), 'unverified');
  assert.deepEqual(truthCounts([l], at(claim.overdue_at, -1)), { claimed: 1, verified: 0, unverified: 0 });
  assert.deepEqual(truthCounts([l], at(claim.overdue_at)), { claimed: 0, verified: 0, unverified: 1 });

  // The completed run: every claim verified, however late the clock.
  const done = lane(happy);
  const all = done.cards.flatMap((c) => c.claims);
  assert.ok(all.length >= 6);
  for (const c of all) assert.equal(chipState(c, at(c.overdue_at!, 86_400_000)), 'verified');

  // A reissued builder step: superseded, never UNVERIFIED, and out of the truth counts.
  const f = lane(findings);
  const voided = f.cards.flatMap((c) => c.claims).filter((c) => c.superseded);
  assert.ok(voided.length > 0, 'the fixture has a superseded claim');
  for (const c of voided) assert.equal(chipState(c, at(c.overdue_at!, 86_400_000)), 'superseded');
  const counted = truthCounts([f], Date.now());
  assert.equal(counted.claimed + counted.verified + counted.unverified, f.cards.flatMap((c) => c.claims).length - voided.length);
});

test('done deck: beyond 5 cards the 4 newest (in true pipeline order: WRAP after the slices) stay, newest first, and the rest collapse with their seals', () => {
  const l = lane(happy);
  const done = cells(l).done;
  assert.deepEqual(done.map(shortLabel), ['INTAKE', 'RECON', 'SCAFFOLD', 'SPEC', 'SLICE PLAN', 'WRAP', 'S1']);
  const d = doneDeck(done);
  assert.deepEqual(d.shown.map(shortLabel), ['WRAP', 'S1', 'SLICE PLAN', 'SPEC']);
  assert.deepEqual(d.rest.map(shortLabel), ['INTAKE', 'RECON', 'SCAFFOLD']);
  // The intake seal moves to the deck; gate 1, gate 2 and merge stay on shown cards. None is lost.
  assert.deepEqual(d.rest.flatMap((c) => sealsOf(c, l)).map((x) => x.kind), ['intake_confirmed']);
  assert.deepEqual(d.shown.flatMap((c) => sealsOf(c, l)).map((x) => x.kind).sort(), ['gate_1_passed', 'gate_2_passed', 'merge_approved']);
  assert.deepEqual(sealsOf(d.rest[0], l).map(sealLine), ['intake confirmed · Master d2t']);

  // Five or fewer: nothing collapses, newest first.
  const five = doneDeck(done.slice(0, 5));
  assert.deepEqual([five.shown.map(shortLabel), five.rest], [['SLICE PLAN', 'SPEC', 'SCAFFOLD', 'RECON', 'INTAKE'], []]);
  const six = doneDeck(done.slice(0, 6));
  assert.deepEqual([six.shown.length, six.rest.map(shortLabel)], [4, ['INTAKE', 'RECON']]);

  // Four done slices: WRAP (and its merge seal) is still the newest, never in the deck.
  const s1 = done.find((c) => c.id === 'slice:S1')!;
  const many = [...done.filter((c) => c.kind === 'stage'), ...['S1', 'S2', 'S3', 'S4'].map((id) => ({ ...s1, id: `slice:${id}`, label: `${id} slice ${id}`, seals: [] }))];
  const m = doneDeck(many);
  assert.deepEqual(m.shown.map(shortLabel), ['WRAP', 'S4', 'S3', 'S2']);
  assert.deepEqual(m.rest.map(shortLabel), ['INTAKE', 'RECON', 'SCAFFOLD', 'SPEC', 'SLICE PLAN', 'S1']);
  assert.deepEqual(sealsOf(m.shown[0], l).map((x) => x.kind), ['merge_approved']);
});

test('type tags: gates, merge, escalations, cut, signal lost, anything else uppercased', () => {
  const tag = (type: string): string => typeTag({ type });
  assert.deepEqual(
    ['gate_1', 'gate_2', 'merge', 'escalation', 'scaffold_failure', 'design_choice', 'cut', 'signal_lost', 'intake', 'new_thing'].map(tag),
    ['GATE', 'GATE', 'MERGE', 'ESCALATION', 'ESCALATION', 'ESCALATION', 'CUT', 'SIGNAL LOST', 'INTAKE', 'NEW THING'],
  );
  // The fixture's open escalation, as the board's Needs You cell holds it: its slice card goes with it.
  const l = lane(upTo(findings, (e) => e.kind === 'escalation_ruled'));
  const n = needsCell(l);
  assert.equal(n.groups.length, 1);
  assert.equal(typeTag(n.groups[0].needs.card), 'ESCALATION');
  assert.deepEqual(n.groups[0].cards.map((c) => c.id), ['slice:S1']);
  assert.deepEqual(n.loose, []);
});

test('empty cells: AWAITING GATE 1, then AWAITING GATE 2 in Backlog before any slice exists; nothing after, or elsewhere', () => {
  const g1 = lane(upTo(happy, (e) => e.kind === 'gate_1_passed'));
  assert.deepEqual(emptyCellCopy(g1, 'backlog'), { title: 'AWAITING GATE 1', body: 'Slices are dealt here once the slice plan clears Gate 2.' });
  for (const col of ['in_progress', 'in_review', 'needs_you', 'done'] as const) assert.equal(emptyCellCopy(g1, col), null);
  const g2 = lane(upTo(happy, (e) => e.kind === 'gate_2_passed'));
  assert.equal(emptyCellCopy(g2, 'backlog')?.title, 'AWAITING GATE 2');
  const dealt = lane(upTo(happy, (e) => e.kind === 'slice_started'));
  assert.ok(dealt.cards.some((c) => c.kind === 'slice'));
  assert.equal(emptyCellCopy(dealt, 'backlog'), null);
  assert.equal(emptyCellCopy(lane(happy), 'backlog'), null);
});

test('counts: board-wide per column; Needs You counts what waits on d2t', () => {
  const done = lane(happy);
  const open = lane(upTo(findings, (e) => e.kind === 'escalation_ruled'), { run_id: 'other-run-zz99' });
  assert.deepEqual(counts([done]), { backlog: 0, in_progress: 0, in_review: 0, needs_you: 0, done: 7 });
  const c = counts([done, open]);
  assert.equal(c.needs_you, 1);
  assert.equal(c.done, 7 + cells(open).done.length);
  assert.equal(c.backlog, cells(open).backlog.length);
  assert.deepEqual(counts([]), { backlog: 0, in_progress: 0, in_review: 0, needs_you: 0, done: 0 });
});

test('upsert: a known lane is replaced in place; a new one goes in by started_at, newest on top; an unstarted one is dropped', () => {
  const base = lane(happy);
  const mk = (run_id: string, started_at: string | null, repo_hash = 'abc123def456'): Lane => ({ ...base, run_id, repo_hash, started_at });
  let ls: Lane[] = [];
  ls = upsertLane(ls, mk('b', '2026-10-24T10:00:00.000Z'));
  ls = upsertLane(ls, mk('c', '2026-10-24T11:00:00.000Z'));
  ls = upsertLane(ls, mk('a', '2026-10-24T09:00:00.000Z'));
  assert.deepEqual(ls.map((l) => l.run_id), ['c', 'b', 'a']);
  // Same started_at: repo_hash, then run_id, as projectBoard orders them.
  ls = upsertLane(ls, mk('bb', '2026-10-24T10:00:00.000Z'));
  ls = upsertLane(ls, mk('b0', '2026-10-24T10:00:00.000Z', '000000000000'));
  assert.deepEqual(ls.map((l) => l.run_id), ['c', 'b0', 'b', 'bb', 'a']);
  // Replaced in place, even if its started_at would sort it elsewhere.
  const before = ls;
  const changed = { ...mk('a', '2026-10-24T09:00:00.000Z'), task: 'changed' };
  ls = upsertLane(ls, changed);
  assert.deepEqual(ls.map((l) => l.run_id), ['c', 'b0', 'b', 'bb', 'a']);
  assert.equal(ls[4].task, 'changed');
  assert.equal(before[4].task, base.task, 'the input array is not mutated');
  // A lane with no run_started is not on the board.
  assert.deepEqual(upsertLane(ls, mk('b', null)).map((l) => l.run_id), ['c', 'b0', 'bb', 'a']);
  assert.deepEqual(upsertLane(ls, mk('new', null)).map((l) => l.run_id), ['c', 'b0', 'b', 'bb', 'a']);
});

test('verdict words, ago, the stage track and the header stage', () => {
  assert.deepEqual(['APPROVE', 'ESCALATE', 'FINDINGS', 'VERDICT: FINDINGS', 'STATUS: DONE\nmore'].map(verdictText), ['APPROVE', 'ESCALATE', 'FINDINGS', 'VERDICT: FINDI', 'STATUS: DONE']);
  const t = '2026-10-24T10:00:00.000Z';
  assert.deepEqual([ago(t, at(t, 5_000)), ago(t, at(t, 4 * 60_000)), ago(t, at(t, 3 * 3600_000)), ago(t, at(t, 23 * 3600_000)), ago(t, at(t, 25 * 3600_000)), ago(t, at(t, 2 * 86_400_000)), ago(null, 0)],
    ['5s ago', '4m ago', '3h ago', '23h ago', '1d ago', '2d ago', 'never']);

  const done = lane(happy);
  assert.deepEqual(stageTrack(done).map((x) => `${x.label}:${x.look}`), [
    'INTAKE:done', 'RECON:done', 'SCAFFOLD:done', 'SPEC:done', 'GATE 1:passed', 'SLICE PLAN:done', 'GATE 2:passed', 'BUILD:done', 'WRAP:done', 'MERGE:passed',
  ]);
  assert.deepEqual(stageWord(done), { text: 'COMPLETE', gold: false });
  const building = lane(upTo(findings, (e) => e.kind === 'ask_raised'));
  assert.deepEqual(stageTrack(building).filter((x) => x.kind === 'step' && x.look === 'now').map((x) => x.label), ['BUILD']);
  assert.deepEqual(stageWord(building), { text: 'BUILD', gold: false });
});

test('a run parked at Gate 1: the gate card holds SPEC, the track waits on GATE 1, the header reads GATE 1 in gold; the active card', () => {
  const card1 = { type: 'gate_1', title: 'Gate 1 — approve the spec', reason_label: 'Spec', reason: 'spec.md · 1 assumption to check', commands: ['/factory approve gate1', '/factory rework gate1 <note…>'] };
  const gate = { v: 1, id: '01JQZZZZZZZZZZZZZZZZZZZ901', ts: '2026-10-24T09:30:00.000Z', run: RUN, kind: 'step_issued', actor: 'cli', corr: 'c', data: { kind: 'ask_human', stage: 'SPEC', attempt: 1, card: card1 } } as unknown as AnyEvent;
  const l = lane([...upTo(happy, (e) => e.kind === 'gate_1_passed'), gate]);
  assert.equal(l.parked, true);
  const n = needsCell(l);
  assert.deepEqual(n.groups.map((g) => [g.needs.card.type, g.cards.map((c) => c.id)]), [['gate_1', ['stage:SPEC']]]);
  assert.deepEqual(n.loose, []);
  const track = stageTrack(l).map((x) => `${x.label}:${x.look}`);
  assert.ok(track.includes('SPEC:done') && track.includes('GATE 1:waiting'), track.join(' '));
  assert.deepEqual(stageWord(l), { text: 'GATE 1', gold: true });

  // BUILD active: the building slice. Only a current stage: that stage's card.
  const building = lane(upTo(findings, (e) => e.kind === 'ask_raised'));
  const slice = building.cards.find((c) => c.kind === 'slice' && c.column === 'in_progress');
  assert.ok(slice, 'a building slice');
  assert.equal(activeCardId(building), slice.id);
  const spec = lane(upTo(happy, (e) => e.kind === 'gate_1_passed'));
  assert.equal(activeCardId(spec), `stage:${spec.stage}`);
});

test('budget clock: `1:12 left of 2:00` with the meter draining and the cut marker at 0:40 left; past 0:00 `+m:ss over` with an empty meter; a stopped clock holds; no budget, no clock', () => {
  const b = { clock_start: '2026-10-24T12:00:00.000Z', limit_min: 120, cut_at: '2026-10-24T13:20:00.000Z', ends_at: '2026-10-24T14:00:00.000Z', stopped_at: null };
  const t = (iso: string): number => Date.parse(iso);
  assert.equal(budgetClock(null, Date.now()), null);
  const mid = budgetClock(b, t('2026-10-24T12:48:00.000Z'))!;
  assert.deepEqual({ ...mid, cut: Number(mid.cut.toFixed(4)) }, { value: '1:12', limit: '2:00', over: false, fill: 0.6, cut: 0.3333, cutLeft: '0:40' });
  assert.equal(budgetClock(b, t('2026-10-24T12:48:30.000Z'))!.value, '1:12', 'a part minute still counts');
  assert.deepEqual(budgetClock(b, t('2026-10-24T14:00:00.000Z'))!, { value: '0:00', limit: '2:00', over: false, fill: 0, cut: 1 / 3, cutLeft: '0:40' });
  const over = budgetClock(b, t('2026-10-24T14:05:03.000Z'))!;
  assert.deepEqual([over.value, over.over, over.fill], ['+5:03', true, 0]);
  const stopped = budgetClock({ ...b, stopped_at: '2026-10-24T13:30:00.000Z' }, t('2026-10-24T20:00:00.000Z'))!;
  assert.deepEqual([stopped.value, stopped.over], ['0:30', false]);
  // A browser clock behind clock_start shows the full limit, never more.
  assert.deepEqual(budgetClock(b, t('2026-10-24T11:50:00.000Z'))!, { value: '2:00', limit: '2:00', over: false, fill: 1, cut: 1 / 3, cutLeft: '0:40' });
  // A limit under the cut lead: the cut point is at the clock start, so the marker sits at the meter's full end.
  assert.equal(budgetClock({ ...b, limit_min: 30, cut_at: '2026-10-24T11:50:00.000Z', ends_at: '2026-10-24T12:30:00.000Z' }, t('2026-10-24T12:00:00.000Z'))!.cut, 1);
  assert.equal(elapsedClock(b, t('2026-10-24T12:48:00.000Z')), null, 'with a limit: the Budget clock, not the elapsed one');
});

test('elapsedClock (6-2): no time limit: whole minutes as h:mm, counting up from clock_start, stopping at stopped_at; no Budget clock', () => {
  const b = { clock_start: '2026-10-24T12:00:00.000Z', limit_min: null, cut_at: null, ends_at: null, stopped_at: null };
  const t = (iso: string): number => Date.parse(iso);
  assert.equal(budgetClock(b, t('2026-10-24T12:47:00.000Z')), null);
  assert.equal(elapsedClock(null, Date.now()), null);
  assert.deepEqual(elapsedClock(b, t('2026-10-24T12:00:00.000Z')), { value: '0:00' });
  assert.deepEqual(elapsedClock(b, t('2026-10-24T12:47:59.000Z')), { value: '0:47' }, 'a part minute does not count yet');
  assert.deepEqual(elapsedClock(b, t('2026-10-24T14:05:00.000Z')), { value: '2:05' });
  assert.deepEqual(elapsedClock(b, t('2026-10-24T11:50:00.000Z')), { value: '0:00' }, 'a browser clock behind clock_start');
  const stopped = { ...b, stopped_at: '2026-10-24T13:30:00.000Z' };
  assert.deepEqual(elapsedClock(stopped, t('2026-10-24T20:00:00.000Z')), { value: '1:30' }, 'stops when the run ends');
  assert.deepEqual(elapsedClock(stopped, t('2026-10-24T13:10:00.000Z')), { value: '1:10' });
});

test('pendingReviewers (3-3): one row per rostered reviewer with no live claim, on a slice being built or reviewed', () => {
  const claim = (role: string, superseded = false) => ({ step_id: role, role, kind: 'spawn', state: 'verified' as const, reported_at: 't', overdue_at: 't', waiting_on: null, waiting_for: null, superseded, evidence: [] });
  const card = { kind: 'slice' as const, state: 'IN_REVIEW', roster: ['reviewer-code', 'reviewer-ux', 'reviewer-a11y'], claims: [claim('builder'), claim('reviewer-code'), claim('reviewer-ux', true)] };
  assert.deepEqual(pendingReviewers(card), ['reviewer-ux', 'reviewer-a11y']);
  assert.deepEqual(pendingReviewers({ ...card, state: 'BUILDING' }), ['reviewer-ux', 'reviewer-a11y']);
  for (const state of ['BACKLOG', 'CLOSED', 'CUT']) assert.deepEqual(pendingReviewers({ ...card, state }), [], state);
  assert.deepEqual(pendingReviewers({ ...card, roster: undefined }), [], 'a slice from before 3-3');
  assert.deepEqual(pendingReviewers({ ...card, kind: 'stage' }), []);
});

test('reviewersAtWork: the generic "reviewers reviewing…" row is only for a slice in review with no pending roster row and no verdict since the newest build', () => {
  const claim = (role: string, reported_at: string, superseded = false) => ({ step_id: role, role, kind: 'spawn', state: 'verified' as const, reported_at, overdue_at: 't', waiting_on: null, waiting_for: null, superseded, evidence: [] });
  const card = { kind: 'slice' as const, state: 'IN_REVIEW', roster: ['reviewer-code', 'reviewer-ux'], claims: [claim('builder', '2'), claim('reviewer-code', '1')] };
  assert.deepEqual(pendingReviewers(card), ['reviewer-ux']);
  assert.equal(reviewersAtWork(card), false, 'pending roster rows already show who is reviewing');
  const full = { ...card, roster: ['reviewer-code'] };
  assert.equal(reviewersAtWork(full), true, 'no verdict since the newest build');
  assert.equal(reviewersAtWork({ ...full, claims: [claim('builder', '2'), claim('reviewer-code', '3')] }), false, 'a verdict after it');
  assert.equal(reviewersAtWork({ ...full, claims: [claim('builder', '2'), claim('reviewer-code', '1'), claim('reviewer-code', '3', true)] }), true, 'a superseded verdict does not count');
  assert.equal(reviewersAtWork({ ...full, roster: undefined }), true, 'a slice from before 3-3');
  assert.equal(reviewersAtWork({ ...full, state: 'BUILDING' }), false);
});

test('time box meter (3-4): `12 / 30 min` against the browser clock, amber (over) once the end passed; none without a running box', () => {
  const ends = Date.parse('2026-10-24T10:30:00.000Z');
  const card = { timebox_ends_at: '2026-10-24T10:30:00.000Z', timebox_min: 30 };
  assert.deepEqual(timeboxMeter(card, ends - 18 * 60_000), { text: '12 / 30 min', fill: 0.4, over: false });
  assert.deepEqual(timeboxMeter(card, ends + 4 * 60_000), { text: '34 / 30 min', fill: 1, over: true });
  assert.equal(timeboxMeter({}, ends), null);
  assert.equal(timeboxMeter({ timebox_ends_at: 'nope', timebox_min: 30 }, ends), null);
});

test('PAUSED notice (6-1): the reason and the local clock time of the stop; none without a pause', () => {
  const at = '2026-10-24T13:24:00.000Z';
  assert.equal(pausedNotice({ paused: { reason: 'human_rejected', at } }), `PAUSED · you rejected a tool call ${clockTime(at)}`);
  assert.equal(pausedNotice({ paused: { reason: 'block_cap', at, blocks: 3 } }), `PAUSED · the conductor stopped after 3 blocks ${clockTime(at)}`);
  assert.match(pausedNotice({ paused: { reason: 'block_cap', at, blocks: 3 } })!, /^PAUSED · the conductor stopped after 3 blocks \d\d:\d\d$/);
  assert.equal(pausedNotice({}), null);
  assert.equal(pausedNotice(lane(happy)), null);
});

test('actionRows (6-2): a card\'s options with their then lines and its reply; an old commands-only card has no then and no reply; SIGNAL LOST has no reply', () => {
  const g = gate1Card({ spec_path: '/s.md', assumptions: 0, lint: { ok: true, errors: [] } });
  assert.deepEqual(actionRows(g), {
    rows: [
      { command: '/factory approve gate1', then: 'SLICE PLAN splits the spec into slices; the next stop is Gate 2' },
      { command: '/factory rework gate1 <note…>', then: 'SPEC is redone with your note; Gate 1 comes back' },
    ],
    reply: 'Ask questions in chat; to change the spec, use rework.',
  });
  assert.deepEqual(actionRows({ commands: ['/factory approve gate1', '/factory rework gate1 <note…>'] }), {
    rows: [{ command: '/factory approve gate1', then: '' }, { command: '/factory rework gate1 <note…>', then: '' }],
  });
  const sl = actionRows(signalLostCard('r-1'));
  assert.deepEqual(sl.rows.map((r) => r.command), ['/factory resume r-1']);
  assert.ok(sl.rows[0].then);
  assert.equal('reply' in sl, false);
});

test('actionRows (8-2): a card with clear_safe closes with the clear line (the mirror equals core\'s), in both shapes; none without it', () => {
  assert.equal(CLEAR_SAFE_LINE, CORE_CLEAR_SAFE_LINE);
  const g = gate1Card({ spec_path: '/s.md', assumptions: 0, lint: { ok: true, errors: [] } });
  const flagged = actionRows({ ...g, clear_safe: true });
  assert.deepEqual(flagged, { ...actionRows(g), clear: CLEAR_SAFE_LINE });
  assert.equal(flagged.reply, 'Ask questions in chat; to change the spec, use rework.');
  assert.equal('clear' in actionRows(g), false);
  assert.deepEqual(actionRows({ commands: ['/factory approve gate1'], clear_safe: true }), { rows: [{ command: '/factory approve gate1', then: '' }], clear: CLEAR_SAFE_LINE });
  assert.equal('clear' in actionRows({ commands: ['/factory approve gate1'] }), false);
});

test('claim waiting (6-3): CLAIMED with a gloss while it waits on Master d2t or on checks, never UNVERIFIED; the drawer proof row says on what', () => {
  const base = { step_id: 'x', role: 'spec-writer', kind: 'spawn', state: 'claimed' as const, reported_at: '2026-10-24T10:00:00.000Z', superseded: false, evidence: [] };
  const human = { ...base, overdue_at: null, waiting_on: 'human' as const, waiting_for: 'Intake — confirm the task' };
  const checks = { ...base, overdue_at: null, waiting_on: 'checks' as const, waiting_for: 'health, test' };
  const facts = { ...base, overdue_at: '2026-10-24T10:00:30.000Z', waiting_on: null, waiting_for: null };
  const late = at('2026-10-24T12:00:00.000Z');
  assert.deepEqual([chipState(human, late), chipGloss(human, chipState(human, late)), proofRow(human, chipState(human, late))], ['claimed', '· awaiting Master d2t', 'waiting on Master d2t — Intake — confirm the task']);
  assert.deepEqual([chipState(checks, late), chipGloss(checks, 'claimed'), proofRow(checks, 'claimed')], ['claimed', '· checks running', 'waiting on health, test']);
  assert.deepEqual([chipState(facts, late), chipGloss(facts, 'unverified'), proofRow(facts, 'unverified')], ['unverified', '· no hook fact', 'no hook fact']);
  assert.deepEqual([chipGloss(facts, 'claimed'), proofRow(facts, 'claimed')], ['', 'none yet']);
  assert.deepEqual([chipGloss(human, 'verified'), chipGloss(human, 'superseded')], ['', '']);
  assert.deepEqual(truthCounts([{ cards: [{ claims: [human, checks, facts] }] } as unknown as Lane], late), { claimed: 2, verified: 0, unverified: 1 }, 'the truth legend keeps three entries');
});

test('artifacts (6-3): lookup by artifact or step id, the gate card\'s file rows, the intake seal\'s artifact, the pinned line, and the replay body join', () => {
  const art = (id: string, step_id: string, stage: Lane['stage'], name: string, pinned_by: string | null, superseded = false) =>
    ({ id, step_id, stage, name, path: `/h/${step_id}/out.md`, sha256: `${id}0123456789abcdef`, body: `body ${id}`, truncated: false, superseded, pinned_by });
  const decisions = [
    { id: 'D1', kind: 'intake_confirmed', at: 't', decided_by: 'human', prompt_text: null, stage: 'INTAKE' as const, evidence: ['chat'], superseded: false },
    { id: 'D2', kind: 'gate_1_passed', at: 't', decided_by: 'human', prompt_text: null, stage: 'SPEC' as const, evidence: ['lint', 'sw'], superseded: false },
  ];
  const lane = { artifacts: [art('A1', 'chat', 'INTAKE', 'intake.md', 'D1'), art('A2', 'sw', 'SPEC', 'spec.md', 'D2'), art('A3', 'ds', 'DESIGN', 'design.md', null)], decisions };
  assert.equal(artifactFor(lane, 'A2')?.name, 'spec.md');
  assert.equal(artifactFor(lane, 'sw')?.id, 'A2', 'a Decision drawer evidence id is a step id');
  assert.equal(artifactFor(lane, 'lint'), null);
  assert.equal(artifactFor({}, 'A2'), null, 'a run from before 6-3');
  assert.deepEqual(gateFiles(lane, { files: ['A2', 'A3', 'gone'] }).map((a) => a.name), ['spec.md', 'design.md']);
  assert.deepEqual(gateFiles(lane, {}), []);
  assert.equal(sealArtifact(lane, decisions[0])?.id, 'A1');
  assert.equal(sealArtifact(lane, decisions[1]), null, 'only the intake seal opens an artifact');
  assert.equal(sealArtifact({}, decisions[0]), null);
  assert.deepEqual(pinnedLine(lane, lane.artifacts[1]).text, 'pinned by Gate 1 · approved by Master d2t');
  assert.deepEqual(pinnedLine(lane, lane.artifacts[2]), { text: 'not yet approved', decision: null });
  assert.equal(shortSha('0123456789abcdef'), '0123456789ab');
  const { body: _b, ...frameArt } = lane.artifacts[1];
  const frame = { ...lane, artifacts: [frameArt] } as never;
  assert.equal(withBodies(frame, { A2: 'the bytes' }).artifacts![0].body, 'the bytes');
  assert.equal(withBodies(frame, undefined).artifacts![0].body, '');
  const none = { decisions } as never;
  assert.equal(withBodies(none, {}), none, 'a frame without artifacts is the lane');
});

test('roster (7-2): every agent role has a character of its own (never the conductor\'s sprite, never its raw id); each run_check id is a check droid', () => {
  const roles = [...REVIEWERS, 'builder', 'designer', 'recon', 'framer', 'scaffolder', 'spec-writer', 'slicer'];
  for (const r of roles) {
    assert.notEqual(spriteFor(r), 'vess', r);
    assert.notEqual(spriteFor(r), 'droid', r);
    assert.ok(ROSTER[r], r);
    assert.notEqual(displayName(r), r);
    assert.equal(roleLabel(r), r, 'a character\'s role label is its role');
    assert.equal(isDroid(r), false);
    assert.match(roleColor(r), /^var\(--role-/);
  }
  assert.deepEqual(Object.fromEntries(['recon', 'framer', 'scaffolder', 'spec-writer', 'slicer'].map((r) => [r, displayName(r)])),
    { recon: 'Nyra', framer: 'Halden', scaffolder: 'Tamsin', 'spec-writer': 'Ione', slicer: 'Sorel' });
  const droids: [string, string, string][] = [
    ['contract.install', 'Crate', 'install check'], ['contract.health', 'Pulse', 'health check'], ['contract.test', 'Gauge', 'test check'], ['spec.lint', 'Margin', 'spec lint'], ['plan.lint', 'Tally', 'plan lint'],
  ];
  for (const [id, name, label] of droids) {
    assert.equal(spriteFor(id), 'droid', id);
    assert.deepEqual([displayName(id), roleLabel(id), isDroid(id)], [name, label, true]);
    assert.equal(ROSTER[id].color, undefined, 'a droid has no role color');
    assert.deepEqual(roleDot(id), { droid: true, style: '' }, `${id}: an outlined dot, no fill`);
  }
  for (const r of roles) assert.deepEqual(roleDot(r), { droid: false, style: `background:var(--role-${r})` }, r);
  // Evidence-only checks are no actor: no droid, their check name stays.
  for (const id of ['git.baseline', 'git.worktree_clean', 'git.deps', 'git.merged', 'devserver']) assert.deepEqual([displayName(id), isDroid(id)], [id, false]);
  // An unknown role: its raw role as the name, the conductor's sprite as a fallback.
  assert.deepEqual([displayName('mystery'), roleLabel('mystery'), spriteFor('mystery'), isDroid('mystery')], ['mystery', 'mystery', 'vess', false]);
});

test('agentsAt (7-2): each In Progress stage card shows its agent (none at INTAKE or WRAP); reviewers at a slice in review; running check droids after, deduped', () => {
  const at = (c: Partial<BoardCard>): string[] => agentsAt({ kind: 'stage', label: 'SPEC', column: 'in_progress', claims: [], ...c });
  const want: Record<string, string[]> = { INTAKE: [], RECON: ['recon'], FRAME: ['framer'], SCAFFOLD: ['scaffolder'], SPEC: ['spec-writer'], DESIGN: ['designer'], 'SLICE PLAN': ['slicer'], WRAP: [] };
  for (const [label, who] of Object.entries(want)) assert.deepEqual(at({ label }), who, label);
  assert.deepEqual(Object.values(STAGE_AGENT).filter((r) => spriteFor(r) === 'vess'), []);
  // Not In Progress or In Review: no crew.
  for (const column of ['backlog', 'needs_you', 'done'] as const) assert.deepEqual(at({ label: 'SCAFFOLD', column, checks_running: ['contract.health'] }), []);
  // Droids beside the agent, or alone.
  assert.deepEqual(at({ label: 'SCAFFOLD', checks_running: ['contract.health'] }), ['scaffolder', 'contract.health']);
  assert.deepEqual(at({ label: 'WRAP', checks_running: ['contract.health', 'contract.test', 'contract.health'] }), ['contract.health', 'contract.test']);
  // Slices: the builder, or the reviewers that reported (superseded ones left out), then the droid.
  const rv = (role: string, superseded = false): Claim => ({ step_id: role, role, kind: 'spawn', state: 'verified', reported_at: '', overdue_at: null, waiting_on: null, waiting_for: null, superseded, evidence: [] });
  assert.deepEqual(at({ kind: 'slice', label: 'S1', checks_running: ['contract.test'] }), ['builder', 'contract.test']);
  assert.deepEqual(at({ kind: 'slice', label: 'S1', column: 'in_review', claims: [rv('builder'), rv('reviewer-code'), rv('reviewer-ux', true)], checks_running: ['contract.test'] }), ['reviewer-code', 'contract.test']);
  // Over a real projection: names are the roster's, never a raw id.
  for (const c of lane(happy).cards) for (const r of agentsAt(c)) assert.notEqual(displayName(r), r);
});
