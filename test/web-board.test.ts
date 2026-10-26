// The board's wiring (lib/board.ts, out of App.svelte): the replay clock is the playhead, Needs You
// announcements are muted at 16× with one summary when it stops, and a drawer whose source is gone
// after a seek closes with focus on the timeline. Plus the drawer's focus return (lib/drawer.ts).
// They import svelte/store, so they are loaded by path and skipped without src/dashboard/web/node_modules.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const WEB = join(import.meta.dirname, '..', 'src', 'dashboard', 'web');
const LIB = join(WEB, 'src', 'lib');
const SKIP = { skip: existsSync(join(WEB, 'node_modules', 'svelte', 'package.json')) ? false : 'svelte is not installed in src/dashboard/web (run npm ci there)' };
interface Store<T> { subscribe(fn: (v: T) => void): () => void }
const get = <T>(s: Store<T>): T => { let v!: T; s.subscribe((x) => { v = x; })(); return v; };

// A lane with only what the wiring reads.
const lane = (run: string, asks: string[] = [], cards: unknown[] = []): any => ({
  repo_hash: 'h', run_id: run, needs_you: asks.map((a) => ({ ask_id: a, card: { type: 'gate_1', title: `ask ${a}` } })), cards, decisions: [], artifacts: [],
});

test('board clock: in replay the board follows the playhead (playback.t), never the live stream clock; offline live holds the last tick', SKIP, async () => {
  const b = await import(join(LIB, 'board.ts'));
  const pb = await import(join(LIB, 'playback.ts'));
  const stream = await import(join(LIB, 'stream.ts'));
  const replay = b.boardSources(true);
  assert.equal(replay.now, pb.t, 'the replay clock is the playhead store');
  assert.equal(replay.lanes, pb.lanes);
  pb.t.set(1_234_567);
  assert.equal(get<number>(replay.now), 1_234_567);
  assert.equal(get(replay.mode), 'live', 'replay is never offline');
  pb.status.set('loading');
  assert.equal(get(replay.loaded), false);
  pb.status.set('ready');
  assert.equal(get(replay.loaded), true);
  const live = b.boardSources(false);
  assert.deepEqual([live.now, live.lanes, live.loaded, live.mode], [stream.now, stream.lanes, stream.loaded, stream.mode]);
  // What chips compare with: the playhead in replay even if mode said offline; the held tick offline.
  assert.equal(b.boardClock(true, 'offline', 500, 100), 500);
  assert.equal(b.boardClock(false, 'live', 500, 100), 500);
  assert.equal(b.boardClock(false, 'offline', 500, 100), 100);
});

test('needs announcer: first load is silent; new cards are announced; at 16× they are muted while playing and one summary follows when it stops', SKIP, async () => {
  const b = await import(join(LIB, 'board.ts'));
  const said: string[] = [];
  const n = b.needsAnnouncer((m: string) => said.push(m));
  assert.equal(n.lanes([lane('r1', ['a1'])], false, false), false, 'not loaded: nothing');
  assert.equal(n.lanes([lane('r1', ['a1'])], true, false), false, 'what waits at first load is not announced');
  assert.deepEqual(said, []);
  assert.equal(n.lanes([lane('r1', ['a1', 'a2'])], true, false), true);
  assert.equal(said.length, 1);
  assert.match(said[0], /^[A-Z0-9 ]+: ask a2, run r1$/);
  // 16× playing: fast, muted; the cards are still marked seen.
  n.fast(true, [lane('r1', ['a1', 'a2'])]);
  assert.equal(n.lanes([lane('r1', ['a1', 'a2', 'a3']), lane('r2', ['b1'])], true, true), false);
  assert.equal(said.length, 1, 'muted at 16×');
  // It stops: one summary of what waits, and the muted cards are not announced late.
  const now = [lane('r1', ['a1', 'a2', 'a3']), lane('r2', ['b1'])];
  n.fast(false, now);
  assert.deepEqual(said.slice(1), ['Needs You: 4 cards']);
  assert.equal(n.lanes(now, true, false), false);
  n.fast(false, now);
  assert.equal(said.length, 2, 'one summary only');
});

test('follow board: after a seek a drawer whose source is gone closes with focus on the timeline; present it stays; live, a gone lane closes it', SKIP, async () => {
  const b = await import(join(LIB, 'board.ts'));
  const d = await import(join(LIB, 'drawer.ts'));
  const card = { id: 'slice:S1', claims: [{ step_id: 'st1' }], seals: [] };
  const sel = { kind: 'claim', lane: 'h/r1', card: 'slice:S1', step: 'st1', src: 'h/r1|slice:S1|st1' };
  let focused = 0;
  const toTimeline = (): void => { focused++; };
  d.selection.set(sel);
  b.followBoard(sel, [lane('r1', [], [card])], true, true, toTimeline);
  assert.deepEqual([get(d.selection), focused], [sel, 0], 'present at the playhead: stays');
  b.followBoard(sel, [lane('r1', [], [card])], false, true, toTimeline);
  assert.deepEqual([get(d.selection), focused], [sel, 0], 'not loaded: untouched');
  b.followBoard(sel, [lane('r1', [], [{ ...card, claims: [] }])], true, true, toTimeline);
  assert.deepEqual([get(d.selection), focused], [null, 1], 'gone at the playhead: closed, focus on the timeline');
  // Live: a drawer stays while its lane is on the board, and closes (no timeline) once the lane is gone.
  d.selection.set(sel);
  b.followBoard(sel, [lane('r1')], true, false, toTimeline);
  assert.equal(get(d.selection), sel);
  b.followBoard(sel, [lane('r2')], true, false, toTimeline);
  assert.deepEqual([get(d.selection), focused], [null, 1]);
});

test('drawer: a control inside the drawer swaps the content but keeps the original opener, so closing returns focus there', SKIP, async () => {
  const d = await import(join(LIB, 'drawer.ts'));
  const board = { kind: 'decision', lane: 'h/r1', card: 'stage:SPEC', decision: 'd1', deck: false, src: 'h/r1|stage:SPEC|d1' };
  d.openDrawer(board);
  assert.equal(d.returnFocusTo(get(d.selection)), board.src);
  // An in-drawer claim chip, then an in-drawer artifact button: the opener is still the seal.
  d.openDrawer({ kind: 'claim', lane: 'h/r1', card: 'stage:SPEC', step: 'st1', src: 'h/r1|stage:SPEC|st1' }, { inDrawer: true });
  assert.equal(get<any>(d.selection).kind, 'claim');
  assert.equal(d.returnFocusTo(get(d.selection)), board.src);
  d.openDrawer({ kind: 'artifact', lane: 'h/r1', card: 'stage:SPEC', artifact: 'A1', src: 'h/r1|decision:d1|A1' }, { inDrawer: true });
  assert.equal(get<any>(d.selection).src, 'h/r1|decision:d1|A1', 'its own src still marks the selected control');
  assert.equal(d.returnFocusTo(get(d.selection)), board.src);
  // A board control opened while the drawer is open is its own opener.
  const chip = { kind: 'claim', lane: 'h/r1', card: 'slice:S1', step: 'st2', src: 'h/r1|slice:S1|st2' };
  d.openDrawer(chip);
  assert.equal(d.returnFocusTo(get(d.selection)), chip.src);
  // closeDrawer focuses the opener's element.
  const g = globalThis as Record<string, unknown>;
  const saved = g.document;
  const focused: string[] = [];
  const el = (src: string) => ({ dataset: { src }, focus: () => focused.push(src) });
  g.document = { querySelectorAll: () => [el(board.src), el('h/r1|decision:d1|A1')] };
  try {
    d.openDrawer(board);
    d.openDrawer({ kind: 'artifact', lane: 'h/r1', card: 'stage:SPEC', artifact: 'A1', src: 'h/r1|decision:d1|A1' }, { inDrawer: true });
    d.closeDrawer();
    assert.deepEqual([get(d.selection), focused], [null, [board.src]]);
  } finally {
    g.document = saved;
  }
});
