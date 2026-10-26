// Replay in the browser (4-1): src/dashboard/web/src/lib/replay.ts (pure) over the served timelines
// of the committed fixture recordings, and the playback store lib/playback.ts (svelte/store, so it
// is loaded by path and skipped without src/dashboard/web/node_modules).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AnyEvent } from '../src/core/events.ts';
import { projectRun, type Lane as CoreLane } from '../src/core/projection.ts';
import { fold } from '../src/core/reducer.ts';
import { buildTimeline, type Timeline } from '../src/core/timeline.ts';
import type { LoadedRecording } from '../src/store/recording.ts';
import type { Selection } from '../src/dashboard/web/src/lib/drawer.ts';
import { agentsAt, chipState, displayName, laneKey } from '../src/dashboard/web/src/lib/model.ts';
import { spriteFor } from '../src/dashboard/web/src/lib/sprites.ts';
import {
  appliedCount, boardAt, boardKey, hms, needsSummary, nextPip, pipLayout, pips, prevPip, recordedDay, replayRoute, replayShortcut, selectionPresent,
} from '../src/dashboard/web/src/lib/replay.ts';
import type { Recording } from '../src/dashboard/web/src/lib/types.ts';

const FIX = join(import.meta.dirname, 'fixtures');
process.env.FACTORY_HOME = FIX; // recordings/ is test/fixtures/recordings; read only here
const { loadRecording } = await import('../src/store/recording.ts');
const NAMES = ['findings-escalation-rework', 'happy-path', 'illegal-then-abandon', 'pipeline-acceptance', 'two-runs'];

const loaded = (name: string): LoadedRecording => {
  const r = loadRecording(name);
  if ('missing' in r) throw new Error(r.missing);
  return r;
};
// What the browser receives: the timeline as JSON. The browser type is a copy of the core one.
const asWeb = (t: Timeline): Recording => JSON.parse(JSON.stringify(t)) as Recording;
const recOf = (name: string): Recording => { const r = loaded(name); return asWeb(buildTimeline(r.manifest, r.runs)); };
const ms = (ts: string): number => Date.parse(ts);
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

test('projection equivalence: at every event\'s `at`, each lane deep-equals projectRun over the loadRun prefix up to it, with live.signal_lost false', () => {
  let checked = 0;
  for (const name of NAMES) {
    const r = loaded(name);
    const rec = asWeb(buildTimeline(r.manifest, r.runs));
    rec.events.forEach((e) => {
      const at = ms(e.at);
      const n = appliedCount(rec, at); // every event with at ≤ e.at: ties replay together
      const ids = new Set(rec.events.slice(0, n).map((x) => x.id));
      const lanes = boardAt(rec, at);
      for (const run of r.runs) {
        const commands = run.loaded.commands.filter((x) => ids.has(x.id));
        const facts = run.loaded.facts.filter((x) => ids.has(x.id));
        const lane = lanes.find((l) => l.run_id === run.run_id && l.repo_hash === run.repo_hash);
        if (!commands.length && !facts.length) { assert.equal(lane, undefined); continue; }
        const want: CoreLane = { ...projectRun({ state: fold(commands), commands, facts, skipped: run.loaded.skipped }, { repo_hash: run.repo_hash, run_id: run.run_id }), live: { signal_lost: false } };
        if (want.started_at === null) { assert.equal(lane, undefined, 'not started: not on the board'); continue; }
        assert.deepStrictEqual(lane, json(want), `${name} at event ${e.kind} ${e.id}`);
        checked++;
      }
    });
  }
  assert.ok(checked > 200, `${checked} playheads checked`);
});

test('opened: at start the board shows exactly the events at or before start', () => {
  const rec = recOf('pipeline-acceptance');
  const start = ms(rec.start);
  const n = appliedCount(rec, start);
  assert.ok(n >= 1);
  assert.ok(rec.events.slice(0, n).every((e) => ms(e.at) <= start) && rec.events.slice(n).every((e) => ms(e.at) > start));
  assert.equal(boardAt(rec, start).length, 1);
  assert.equal(boardAt(rec, start - 1).length, 0, 'nothing before the first event');
  assert.equal(appliedCount(rec, ms(rec.end)), rec.events.length);
});

// A copy of happy-path with a 10-minute silence after the builder's slice starts.
function withGap(): { rec: Recording; gapFrom: number; resume: number } {
  const r = loaded('happy-path');
  const run = r.runs[0].loaded;
  const k = run.commands.findIndex((e) => e.kind === 'slice_started') + 2;
  const cut = run.commands[k - 1].ts;
  const shift = (e: AnyEvent): AnyEvent => (e.ts > cut ? { ...e, ts: new Date(ms(e.ts) + 600_000).toISOString() } : e) as AnyEvent;
  const commands = run.commands.map(shift);
  const facts = run.facts.map(shift);
  const rec = asWeb(buildTimeline(r.manifest, [{ ...r.runs[0], loaded: { ...run, state: fold(commands), commands, facts } }]));
  return { rec, gapFrom: ms(cut), resume: ms(commands[k].ts) };
}

test('gap: past the last event + signal_lost_ms on a working lane, SIGNAL LOST joins Needs You as the live server shapes it; the next event ends it', () => {
  const { rec, gapFrom, resume } = withGap();
  const lane = (t: number) => boardAt(rec, t)[0];
  const before = lane(gapFrom + rec.signal_lost_ms - 1);
  assert.deepEqual([before.terminal, before.parked, before.live], [false, false, { signal_lost: false }]);
  assert.equal(before.deadlines.signal_lost_at, new Date(gapFrom + rec.signal_lost_ms).toISOString());
  assert.equal(before.last_event_at, new Date(gapFrom).toISOString());
  const lost = lane(gapFrom + rec.signal_lost_ms);
  assert.deepEqual(lost.live, { signal_lost: true });
  assert.deepEqual(lost.needs_you.at(-1), { ask_id: 'signal_lost', raised_at: lost.deadlines.signal_lost_at, card: rec.runs[0].signal_lost_card });
  assert.equal(lost.needs_you.at(-1)!.card.title, 'SIGNAL LOST — add-login-page-q7k2');
  assert.notEqual(boardKey(rec, gapFrom + rec.signal_lost_ms - 1), boardKey(rec, gapFrom + rec.signal_lost_ms), 'the board recomputes when the flag flips');
  assert.equal(boardKey(rec, gapFrom + rec.signal_lost_ms), boardKey(rec, resume - 1), 'and not on every tick');
  const back = lane(resume);
  assert.deepEqual(back.live, { signal_lost: false });
  assert.ok(!back.needs_you.some((x) => x.ask_id === 'signal_lost'));
  // A terminal run never loses its signal, however late the playhead.
  const done = recOf('happy-path');
  assert.deepEqual(boardAt(done, ms(done.end) + 86_400_000)[0].live, { signal_lost: false });
  // An open run at its end: lost once signal_lost_ms passes.
  const open = recOf('findings-escalation-rework');
  assert.deepEqual(boardAt(open, ms(open.end) + open.signal_lost_ms)[0].live, { signal_lost: true });
});

test('decision pips: one gold pip per decision event, labelled `<event> · <run-id>`; next decision from 00:00:00 lands on the first and the board shows its seal', () => {
  const kinds = new Set<string>();
  for (const name of NAMES) {
    const rec = recOf(name);
    const ps = pips(rec);
    assert.deepEqual(ps.map((p) => p.id), rec.events.filter((e) => e.decision).map((e) => e.id), name);
    for (const p of ps) {
      kinds.add(p.kind);
      assert.equal(p.label, `${({ intake_confirmed: 'Intake', gate_1_passed: 'Gate 1', gate_2_passed: 'Gate 2', merge_approved: 'Merge', escalation_ruled: 'Escalation', cut_decided: 'Cut', rework_requested: 'Rework', run_abandoned: 'Abandon' } as Record<string, string>)[p.kind]} · ${rec.runs[p.run].run_id}`);
      // At the pip, the decision is sealed on a card.
      const lane = boardAt(rec, p.at).find((l) => l.run_id === rec.runs[p.run].run_id)!;
      assert.ok(lane.decisions.some((d) => d.id === p.id && d.decided_by === 'human'));
      if (p.kind !== 'run_abandoned' && p.kind !== 'escalation_ruled') assert.ok(lane.cards.some((c) => c.seals.includes(p.id)), `${name}: ${p.kind} sealed`);
      // Just before it, not yet.
      assert.ok(!boardAt(rec, p.at - 1).some((l) => l.decisions.some((d) => d.id === p.id)));
    }
    const first = nextPip(ps, ms(rec.start));
    assert.deepEqual(first, ps[0]);
    assert.equal(prevPip(ps, ms(rec.start)), null);
    assert.equal(nextPip(ps, ps.at(-1)!.at), null);
    assert.deepEqual(prevPip(ps, ps[1]?.at ?? Infinity), ps[0]);
    assert.deepEqual(nextPip(ps, ps[0].at), ps[1] ?? null);
  }
  for (const k of ['gate_1_passed', 'gate_2_passed', 'escalation_ruled', 'cut_decided', 'rework_requested', 'merge_approved']) assert.ok(kinds.has(k), `the fixtures have a ${k} pip`);
});

test('seek with the drawer open: a claim absent at the playhead closes it; present but not yet verified it stays and reads CLAIMED; a decision before its pip closes it', () => {
  const rec = recOf('happy-path');
  const end = boardAt(rec, ms(rec.end))[0];
  const key = laneKey(end);
  const card = end.cards.find((c) => c.id === 'slice:S1')!;
  const claim = card.claims[0];
  const sel: Selection = { kind: 'claim', lane: key, card: card.id, step: claim.step_id, src: 'x' };
  assert.ok(selectionPresent(sel, boardAt(rec, ms(rec.end))));
  const reported = ms(claim.reported_at);
  assert.equal(selectionPresent(sel, boardAt(rec, reported - 1)), false, 'not reported yet: gone');
  const mid = boardAt(rec, reported);
  assert.ok(selectionPresent(sel, mid));
  const c = mid[0].cards.find((x) => x.id === card.id)!.claims.find((x) => x.step_id === claim.step_id)!;
  assert.equal(chipState(c, reported), 'claimed', 'the claim reverts to CLAIMED');
  const gate = end.decisions.find((d) => d.kind === 'gate_1_passed')!;
  const dsel: Selection = { kind: 'decision', lane: key, card: 'stage:SPEC', decision: gate.id, deck: false, src: 'y' };
  assert.ok(selectionPresent(dsel, boardAt(rec, ms(gate.at))));
  assert.equal(selectionPresent(dsel, boardAt(rec, ms(gate.at) - 1)), false);
  assert.equal(selectionPresent({ ...dsel, lane: 'other/run' }, boardAt(rec, ms(rec.end))), false);
});

test('pip labels alternate above and below, anchor right past 70%, and a label that would overlap its row\'s previous one is left out', () => {
  const pip = (at: number, label = 'Gate 1 · r-1'): { index: number; at: number; id: string; kind: string; run: number; label: string } => ({ index: 0, at, id: String(at), kind: 'gate_1_passed', run: 0, label });
  const places = pipLayout([pip(0), pip(10), pip(20), pip(500), pip(900)], 0, 1000, 1000);
  assert.deepEqual(places.map((p) => [p.x, p.row, p.anchor]), [[0, 'up', 'l'], [1, 'dn', 'l'], [2, null, 'l'], [50, 'up', 'l'], [90, 'dn', 'r']]);
  assert.deepEqual(pipLayout([], 0, 0, 0), []);
});

test('replay keyboard: Space plays, ←/→ jump decisions; never on a native control (→ on a speed radio is the radio\'s own), never with a modifier', () => {
  const div = { tagName: 'DIV' };
  assert.equal(replayShortcut({ key: ' ', target: div }), 'toggle');
  assert.equal(replayShortcut({ key: 'ArrowLeft', target: div }), 'prev');
  assert.equal(replayShortcut({ key: 'ArrowRight', target: { tagName: 'BODY' } }), 'next');
  for (const tagName of ['INPUT', 'BUTTON', 'A', 'SELECT', 'TEXTAREA', 'input']) {
    for (const key of [' ', 'ArrowLeft', 'ArrowRight']) assert.equal(replayShortcut({ key, target: { tagName } }), null, `${key} on ${tagName}`);
  }
  assert.equal(replayShortcut({ key: 'ArrowRight', target: { tagName: 'DIV', isContentEditable: true } }), null);
  assert.equal(replayShortcut({ key: 'ArrowRight', target: div, shiftKey: true }), null);
  assert.equal(replayShortcut({ key: ' ', target: div, metaKey: true }), null);
  assert.equal(replayShortcut({ key: 'Enter', target: div }), null);
});

test('route, readouts and the 16× summary', () => {
  assert.equal(replayRoute('/'), null);
  assert.equal(replayRoute('/replays'), null);
  assert.deepEqual(replayRoute('/replay/2026-10-22'), { name: '2026-10-22' });
  assert.deepEqual(replayRoute('/replay/demo/'), { name: 'demo' });
  assert.deepEqual(replayRoute('/replay/'), { bad: '' });
  assert.deepEqual(replayRoute('/replay'), { bad: '' });
  assert.deepEqual(replayRoute('/replay/a/b'), { bad: 'a/b' });
  assert.deepEqual(replayRoute('/replay/a..b'), { bad: 'a..b' });
  assert.deepEqual(replayRoute('/replay/%E0%A4'), { bad: '%E0%A4' });
  assert.deepEqual([hms(0), hms(999), hms(61_000), hms(3_600_000 * 2 + 47 * 60_000 + 12_000), hms(-5)], ['00:00:00', '00:00:00', '00:01:01', '02:47:12', '00:00:00']);
  assert.match(recordedDay('2026-10-25T12:00:00.000Z'), /^2026-10-2[56]$/);
  assert.equal(recordedDay('nope'), '');
  const rec = recOf('findings-escalation-rework');
  const lanes = boardAt(rec, ms(rec.end) + rec.signal_lost_ms);
  assert.equal(needsSummary(lanes), `Needs You: ${lanes[0].needs_you.length} card${lanes[0].needs_you.length === 1 ? '' : 's'}`);
  assert.equal(needsSummary([]), 'Needs You: 0 cards');
});

test('several runs: lanes in projectBoard order (newest run_started first), each from its own latest event', () => {
  const r = loaded('happy-path');
  const run = r.runs[0].loaded;
  const later = (e: AnyEvent): AnyEvent => ({ ...e, run: 'second-run', ts: new Date(ms(e.ts) + 5000).toISOString() }) as AnyEvent;
  const commands2 = run.commands.map(later);
  const rec = asWeb(buildTimeline(r.manifest, [r.runs[0], { repo_hash: 'abc123def456', run_id: 'second-run', loaded: { ...run, state: fold(commands2), commands: commands2, facts: [] } }]));
  const at = ms(run.commands[10].ts) + 5000;
  const lanes = boardAt(rec, at);
  assert.deepEqual(lanes.map((l) => l.run_id), ['second-run', 'add-login-page-q7k2']);
  assert.equal(lanes[0].last_event_at, new Date(at).toISOString());
  assert.ok(lanes[1].last_event_at! <= lanes[0].last_event_at!);
  assert.ok(lanes[1].cards.flatMap((c) => c.claims).length > lanes[0].cards.flatMap((c) => c.claims).length, 'the first run is 5 s ahead');
  assert.deepEqual(pips(rec).map((p) => p.label).slice(0, 2), ['Intake · add-login-page-q7k2', 'Intake · second-run']);
});

test('Replay Flow 2 (5-1): the two-run recording shows two concurrent lanes, the newest on top, one in BUILD and one waiting at Gate 1; next decision crosses both runs\' pips', () => {
  const rec = recOf('two-runs');
  assert.deepEqual(rec.runs.map((r) => r.run_id), ['add-search-box-m3p8', 'add-signup-form-r5t1']);
  const [a, b] = rec.runs.map((r) => r.run_id);
  const lanes = boardAt(rec, ms(rec.end));
  assert.deepEqual(lanes.map((l) => [l.run_id, l.phase, l.stage]), [[b, 'SPEC_DESIGN', 'SPEC'], [a, 'BUILD', 'BUILD']], 'B started later: on top');
  assert.deepEqual(lanes[0].gates.map((g) => g.status), ['waiting', 'hollow']);
  assert.deepEqual(lanes[0].needs_you.map((n) => n.card.type), ['gate_1']);
  assert.deepEqual(lanes[1].needs_you, []);
  assert.ok(lanes[1].cards.some((c) => c.id === 'slice:S1' && c.column === 'in_progress'), 'A builds S1');
  // Before B starts, one lane; once it has, two.
  const bStart = ms(rec.events.find((e) => rec.runs[e.run].run_id === b)!.at);
  assert.deepEqual(boardAt(rec, bStart - 1).map((l) => l.run_id), [a]);
  assert.deepEqual(boardAt(rec, bStart).map((l) => l.run_id), [b, a]);
  // next decision from 00:00:00 visits every pip of both runs, in time order, each naming its run.
  const ps = pips(rec);
  const visited: string[] = [];
  for (let p = nextPip(ps, ms(rec.start)); p; p = nextPip(ps, p.at)) {
    visited.push(p.label);
    const lane = boardAt(rec, p.at).find((l) => l.run_id === rec.runs[p.run].run_id)!;
    assert.ok(lane.decisions.some((d) => d.id === p.id), `${p.label} is on its lane at its pip`);
  }
  assert.deepEqual(visited, [`Intake · ${a}`, `Intake · ${b}`, `Gate 1 · ${a}`, `Gate 2 · ${a}`]);
});

// --- the playback store ---------------------------------------------------------------------------

const WEB = join(import.meta.dirname, '..', 'src', 'dashboard', 'web');
const SKIP = { skip: existsSync(join(WEB, 'node_modules', 'svelte', 'package.json')) ? false : 'svelte is not installed in src/dashboard/web (run npm ci there)' };
interface Store<T> { subscribe(fn: (v: T) => void): () => void }
const get = <T>(s: Store<T>): T => { let v!: T; s.subscribe((x) => { v = x; })(); return v; };

test('playback: loading → opened paused at the start; play, 16× is fast, the end pauses at the last event, play restarts from 00:00:00; next decision pauses on the pip; seek clamps; a 404 is not found', SKIP, async (t) => {
  const g = globalThis as Record<string, unknown>;
  const saved = { fetch: g.fetch, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  t.after(() => { g.fetch = saved.fetch; g.requestAnimationFrame = saved.raf; g.cancelAnimationFrame = saved.caf; });
  // The animation frame loop, driven by hand with explicit timestamps.
  const pending = new Map<number, (ts: number) => void>();
  let rafId = 0;
  g.requestAnimationFrame = (cb: (ts: number) => void): number => { pending.set(++rafId, cb); return rafId; };
  g.cancelAnimationFrame = (id: number): void => { pending.delete(id); };
  const frame = (ts: number): void => {
    assert.equal(pending.size, 1, 'one frame is scheduled');
    const [[id, cb]] = [...pending];
    pending.delete(id);
    cb(ts);
  };
  const rec = recOf('happy-path');
  const body = JSON.stringify(rec);
  const calls: string[] = [];
  g.fetch = async (url: string) => {
    calls.push(url);
    return url.endsWith('/happy-path') ? { ok: true, status: 200, json: async () => JSON.parse(body) } : { ok: false, status: 404, json: async () => ({ error: { code: 'RECORDING_NOT_FOUND' } }) };
  };
  const pb = await import(join(WEB, 'src', 'lib', 'playback.ts'));
  const start = ms(rec.start);
  const end = ms(rec.end);

  const p = pb.load('happy-path');
  assert.equal(get(pb.status), 'loading');
  await p;
  assert.deepEqual(calls, ['/api/recordings/happy-path']);
  assert.equal(get(pb.status), 'ready');
  assert.deepEqual([get(pb.t), get(pb.playing), get(pb.speed), get(pb.fast)], [start, false, 1, false]);
  assert.deepEqual(get(pb.lanes), boardAt(rec, start));
  assert.equal(get(pb.decisionPips).length, 4);

  const { streak } = await import(join(WEB, 'src', 'lib', 'glide.ts'));
  assert.ok(streak({} as Element).duration > 0, 'travel animates at 1×');

  pb.play();
  assert.equal(get(pb.playing), true);
  assert.equal(pending.size, 1, 'play schedules a frame');
  frame(10_000);
  assert.equal(get(pb.t), start, 'the first frame only sets the baseline');
  frame(11_000);
  assert.equal(get(pb.t), start + 1000, '1× is real time');
  // The speed radio: → on it changes the speed (natively), the playhead does not move.
  assert.equal(replayShortcut({ key: 'ArrowRight', target: { tagName: 'INPUT' } }), null);
  pb.setSpeed(4);
  assert.deepEqual([get(pb.speed), get(pb.t)], [4, start + 1000]);
  frame(12_000);
  assert.equal(get(pb.t), start + 5000, '4×: dt × 4');
  pb.setSpeed(16);
  assert.equal(get(pb.fast), true, '16× while playing');
  assert.equal(streak({} as Element).duration, 0, 'travel is skipped at 16× while playing');
  frame(12_500);
  assert.equal(get(pb.t), start + 13_000, '16×: dt × 16');
  assert.equal(pending.size, 1, 'the loop re-schedules while playing');
  pb.pause();
  assert.deepEqual([pending.size, get(pb.fast)], [0, false], 'nothing pending after pause');
  assert.ok(streak({} as Element).duration > 0, 'travel animates again once paused');
  pb.play();
  frame(20_000);
  assert.equal(get(pb.t), start + 13_000, 'resuming sets a fresh baseline');
  frame(80_000);
  assert.deepEqual([get(pb.t), get(pb.playing), get(pb.fast), pending.size], [end, false, false, 0], 'paused at the last event, nothing pending');
  assert.deepEqual(get(pb.lanes), boardAt(rec, end));
  pb.play();
  assert.deepEqual([get(pb.t), get(pb.playing)], [start, true], 'play at the end restarts from 00:00:00');
  pb.pause();
  assert.equal(pending.size, 0);

  pb.seek(start - 10_000);
  assert.equal(get(pb.t), start);
  pb.seek(end + 10_000);
  assert.equal(get(pb.t), end);
  pb.seek(start);
  pb.setSpeed(1);
  pb.play();
  pb.nextDecision();
  const first = pips(rec)[0];
  assert.deepEqual([get(pb.t), get(pb.playing)], [first.at, false], 'next decision pauses on the first pip');
  assert.ok(get<CoreLane[]>(pb.lanes)[0].cards.some((c) => c.seals.includes(first.id)), 'and the board shows its seal');
  pb.nextDecision();
  pb.prevDecision();
  assert.equal(get(pb.t), first.at);

  await pb.load('nope');
  assert.equal(get(pb.status), 'missing');
  assert.deepEqual(get(pb.lanes), []);
  pb.toggle();
  assert.equal(get(pb.playing), false, 'nothing plays without a recording');
});

test('artifact bodies (6-3): frames carry artifacts without a body, each body sits once in artifact_bodies, and boardAt joins them back; an artifact selection follows the playhead', () => {
  const r = loaded('happy-path');
  const run = r.runs[0].loaded;
  const spec = run.commands.find((e) => e.kind === 'step_issued' && (e.data as { role?: string }).role === 'spec-writer')!;
  const verified = run.commands.find((e) => e.kind === 'step_verified' && (e.data as { step_id: string }).step_id === spec.id)!;
  const body = '# Footer\nAPI_TOKEN=[REDACTED]\n';
  const commands = run.commands.map((e) => (e.id === verified.id ? { ...e, data: { ...e.data, artifact: { path: '/h/spec/out.md', sha256: 's1', body, truncated: false } } } : e)) as AnyEvent[];
  const t = buildTimeline(r.manifest, [{ ...r.runs[0], loaded: { ...run, state: fold(commands), commands } }]);
  assert.deepEqual(t.artifact_bodies, { [verified.id]: body });
  const framed = t.frames.flatMap((f) => f.artifacts ?? []);
  assert.ok(framed.length > 0 && framed.every((a) => !('body' in a)), 'no body in any frame');
  assert.equal(buildTimeline(r.manifest, r.runs).artifact_bodies, undefined, 'absent when no artifact is embedded');

  const rec = asWeb(t);
  const end = ms(rec.end);
  const [lane] = boardAt(rec, end);
  const live = projectRun({ state: fold(commands), commands, facts: run.facts, skipped: run.skipped }, { repo_hash: r.runs[0].repo_hash, run_id: r.runs[0].run_id });
  assert.deepEqual(lane.artifacts, json(live.artifacts), 'the joined lane carries what the live board serves');
  assert.equal(lane.artifacts![0].body, body);
  const sel: Selection = { kind: 'artifact', lane: laneKey(lane), card: 'stage:SPEC', artifact: verified.id, src: 'x' };
  assert.equal(selectionPresent(sel, boardAt(rec, end)), true);
  assert.equal(selectionPresent(sel, boardAt(rec, ms(verified.ts) - 1)), false, 'before its step_verified the artifact is not on the board');
});

test('names (7-2): over every pipeline-acceptance frame, no agent or check claim and no crew member shows a raw role or run_check id, none is drawn as the conductor, and check droids stand only while their checks run', () => {
  const rec = recOf('pipeline-acceptance');
  const CHECKS = ['contract.install', 'contract.health', 'contract.test', 'spec.lint', 'plan.lint'];
  let checkClaims = 0;
  let droidsShown = 0;
  for (const f of rec.frames) for (const c of f.cards) {
    // Agent and check claims; the conductor's own steps (ask_human, enter/exit_worktree) have no role.
    for (const cl of c.claims.filter((x) => x.kind === 'spawn' || x.kind === 'resume' || x.kind === 'run_check')) {
      assert.notEqual(displayName(cl.role), cl.role, `${c.id} ${cl.role}`);
      assert.notEqual(spriteFor(cl.role), 'vess', cl.role);
      if (CHECKS.includes(cl.role)) checkClaims++;
    }
    for (const r of agentsAt(c)) {
      assert.notEqual(displayName(r), r, `${c.id} crew ${r}`);
      if (CHECKS.includes(r)) { droidsShown++; assert.ok(c.checks_running?.includes(r)); }
    }
    if (c.checks_running) assert.ok(c.checks_running.length > 0, 'present only when non-empty');
  }
  assert.ok(checkClaims > 0, 'the recording has check claims');
  assert.ok(droidsShown > 0, 'the recording shows check droids');
});
