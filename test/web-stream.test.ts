// The board's data flow (src/dashboard/web/src/lib/stream.ts) and its announcer (lib/announce.ts),
// with fetch and EventSource stubbed and the timers mocked. Both import svelte/store, which only
// resolves from src/dashboard/web/node_modules.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mock, test } from 'node:test';

const WEB = join(import.meta.dirname, '..', 'src', 'dashboard', 'web');
const SKIP = { skip: existsSync(join(WEB, 'node_modules', 'svelte', 'package.json')) ? false : 'svelte is not installed in src/dashboard/web (run npm ci there)' };
// Loaded by path at run time, so neither node nor tsc needs svelte when the test is skipped.
const STREAM = join(WEB, 'src', 'lib', 'stream.ts');
const ANNOUNCE = join(WEB, 'src', 'lib', 'announce.ts');

interface Store<T> { subscribe(fn: (v: T) => void): () => void }
const get = <T>(s: Store<T>): T => { let v!: T; s.subscribe((x) => { v = x; })(); return v; };
type LaneLike = { repo_hash: string; run_id: string; started_at: string | null };
const laneOf = (run_id: string, started_at: string | null): LaneLike => ({ repo_hash: 'aaaaaaaaaaaa', run_id, started_at });

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static all: FakeEventSource[] = [];
  url: string;
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, (e: { data: string; lastEventId: string }) => void>();
  constructor(url: string) { this.url = url; FakeEventSource.all.push(this); }
  addEventListener(type: string, fn: (e: { data: string; lastEventId: string }) => void): void { this.listeners.set(type, fn); }
  close(): void { this.readyState = FakeEventSource.CLOSED; }
  emit(type: string, data: unknown, id: string): void { this.listeners.get(type)!({ data: JSON.stringify(data), lastEventId: id }); }
}

const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('stream: fetch then SSE from the cursor; run upserts, board replaces; offline on error; a closed stream reopens after 2 s from the last id', SKIP, async (t) => {
  const g = globalThis as Record<string, unknown>;
  const saved = { fetch: g.fetch, EventSource: g.EventSource };
  t.after(() => { g.fetch = saved.fetch; g.EventSource = saved.EventSource; mock.timers.reset(); });
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const A = laneOf('alpha-aaaa', '2026-10-24T09:00:00.000Z');
  const urls: string[] = [];
  g.fetch = async (url: string) => { urls.push(url); return { ok: true, json: async () => ({ cursor: 7, projection: { runs: [A] } }) }; };
  g.EventSource = FakeEventSource;
  const s = await import(STREAM);

  const stop = s.connect();
  t.after(stop);
  await flush();
  assert.deepEqual(urls, ['/api/board']);
  assert.deepEqual(get<LaneLike[]>(s.lanes), [A]);
  assert.equal(get(s.mode), 'live');
  assert.equal(FakeEventSource.all.length, 1);
  const es = FakeEventSource.all[0];
  assert.equal(es.url, '/api/stream?since=7');

  // `run`: a newer lane goes on top; the same lane again is replaced in place.
  const B = laneOf('beta-bbbb', '2026-10-24T10:00:00.000Z');
  es.emit('run', B, '8');
  assert.deepEqual(get<LaneLike[]>(s.lanes).map((l) => l.run_id), ['beta-bbbb', 'alpha-aaaa']);
  es.emit('run', { ...A, task: 'changed' }, '8');
  assert.deepEqual(get<(LaneLike & { task?: string })[]>(s.lanes).map((l) => [l.run_id, l.task]), [['beta-bbbb', undefined], ['alpha-aaaa', 'changed']]);

  // `board`: everything replaced; an unstarted lane is not on the board.
  const C = laneOf('gamma-cccc', '2026-10-24T11:00:00.000Z');
  es.emit('board', { cursor: 9, projection: { runs: [C, laneOf('nope-dddd', null)] } }, '9');
  assert.deepEqual(get<LaneLike[]>(s.lanes), [C]);

  // An error while the browser reconnects: offline, and the browser's own retry is left alone.
  es.onerror!();
  assert.equal(get(s.mode), 'offline');
  assert.equal(FakeEventSource.all.length, 1);
  es.onopen!();
  assert.equal(get(s.mode), 'live');

  // Closed for good: reopened after 2 s, from the last id seen.
  es.readyState = FakeEventSource.CLOSED;
  es.onerror!();
  assert.equal(get(s.mode), 'offline');
  mock.timers.tick(1999);
  assert.equal(FakeEventSource.all.length, 1);
  mock.timers.tick(1);
  assert.equal(FakeEventSource.all.length, 2);
  assert.equal(FakeEventSource.all[1].url, '/api/stream?since=9');
  FakeEventSource.all[1].onopen!();
  assert.equal(get(s.mode), 'live');
});

test('announce: messages within 1 s coalesce into one; an urgent one goes out at once', SKIP, async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const a = await import(ANNOUNCE);
  const said: string[] = [];
  const off = a.message.subscribe((m: string) => { if (m) said.push(m); });
  t.after(off);

  a.announce('GATE: Gate 1 — approve the spec, run alpha-aaaa');
  mock.timers.tick(500);
  a.announce('ESCALATION: Builder stuck on S1, run beta-bbbb');
  mock.timers.tick(499);
  assert.deepEqual(said, []);
  mock.timers.tick(1); // the window closes; the message goes out after its 30 ms re-arm
  mock.timers.tick(30);
  assert.deepEqual(said, ['GATE: Gate 1 — approve the spec, run alpha-aaaa. ESCALATION: Builder stuck on S1, run beta-bbbb']);

  a.announce('Copied', { urgent: true });
  mock.timers.tick(30);
  assert.deepEqual(said.at(-1), 'Copied');
  assert.equal(said.length, 2);
});
