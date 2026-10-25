// The board store (2-2 Data flow): GET /api/board, then the SSE stream from that cursor. `run`
// replaces or inserts one lane, `board` replaces them all. The browser's own reconnect sends
// Last-Event-ID, which the server honors; a stream closed for good is reopened after 2 s from the
// last id seen. A 1 s clock drives every deadline comparison (chips, `ago`).
import { readable, writable, type Readable } from 'svelte/store';
import { upsertLane } from './model.ts';
import type { Lane, Snapshot } from './types.ts';

export type Mode = 'live' | 'offline';

export const lanes = writable<Lane[]>([]);
export const loaded = writable(false); // a projection has arrived at least once
export const mode = writable<Mode>('live');

export const now: Readable<number> = readable(Date.now(), (set) => {
  const t = setInterval(() => set(Date.now()), 1000);
  return () => clearInterval(t);
});

const REOPEN_MS = 2000;

const started = (runs: readonly Lane[]): Lane[] => runs.filter((l) => l.started_at !== null);

export function connect(): () => void {
  let es: EventSource | null = null;
  let last: string | null = null; // the newest event id (= cursor) seen
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const snapshot = (s: Snapshot): void => {
    lanes.set(started(s.projection.runs));
    loaded.set(true);
  };

  const open = (): void => {
    if (stopped) return;
    es = new EventSource(last === null ? '/api/stream' : `/api/stream?since=${encodeURIComponent(last)}`);
    es.onopen = () => mode.set('live');
    es.addEventListener('run', (e) => {
      const m = e as MessageEvent<string>;
      if (m.lastEventId) last = m.lastEventId;
      try { lanes.update((ls) => upsertLane(ls, JSON.parse(m.data) as Lane)); loaded.set(true); } catch { /* a bad frame changes nothing */ }
    });
    es.addEventListener('board', (e) => {
      const m = e as MessageEvent<string>;
      if (m.lastEventId) last = m.lastEventId;
      try { snapshot(JSON.parse(m.data) as Snapshot); } catch { /* ignored */ }
    });
    es.onerror = () => {
      mode.set('offline');
      if (es && es.readyState === EventSource.CLOSED) {
        es = null;
        if (timer === null) timer = setTimeout(() => { timer = null; open(); }, REOPEN_MS);
      }
    };
  };

  fetch('/api/board', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<Snapshot>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((s) => { snapshot(s); last = String(s.cursor); mode.set('live'); })
    .catch(() => mode.set('offline')) // the stream's first event is then a whole snapshot
    .finally(open);

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    es?.close();
  };
}
