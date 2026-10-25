// Tails ~/.factory/*/runs/*/{commands.jsonl,facts/*.jsonl} (AD-16): a recursive fs.watch (debounced)
// plus a DASHBOARD_POLL_MS scan. Each file is read from its stored byte offset through store/jsonl.ts,
// and reset to 0 when it shrank below that offset or its inode changed. A touched run is reloaded with
// loadRun and reprojected; a changed lane gets a new cursor and goes to the subscribers.
import { existsSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join, sep } from 'node:path';
import { DASHBOARD_POLL_MS } from '../../core/config.ts';
import { projectRun, type Lane } from '../../core/projection.ts';
import { readLines } from '../../store/jsonl.ts';
import { loadRun } from '../../store/load-run.ts';
import { commandsFile, factoryHome, factsDir, runDir, runsDir } from '../../store/paths.ts';
import { isSafeId } from '../../store/sessions.ts';
import type { Cache } from './cache.ts';

export interface LaneChange { repo_hash: string; run_id: string; cursor: number; lane: Lane }
export interface ScanResult { changed: LaneChange[]; removed: { repo_hash: string; run_id: string }[] }

const DEBOUNCE_MS = 50;

const dirs = (dir: string): string[] => {
  try { return readdirSync(dir).filter((n) => isSafeId(n)).sort(); } catch { return []; }
};

export class Tail {
  private watcher: FSWatcher | null = null;
  private poll: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;

  private cache: Cache;
  private onScan: (r: ScanResult) => void;
  private log: (msg: string) => void;

  constructor(cache: Cache, onScan: (r: ScanResult) => void, log: (msg: string) => void = () => {}) {
    this.cache = cache;
    this.onScan = onScan;
    this.log = log;
  }

  // The run files: commands first, then facts in name order.
  private files(hash: string, runId: string): string[] {
    const fdir = factsDir(hash, runId);
    let facts: string[] = [];
    try { facts = readdirSync(fdir).filter((n) => n.endsWith('.jsonl')).sort().map((n) => join(fdir, n)); } catch { /* no facts yet */ }
    return [commandsFile(hash, runId), ...facts];
  }

  // Reads what is new in one file into the events table. True when the run must be reprojected.
  private ingest(file: string, hash: string, runId: string): boolean {
    let st;
    try { st = statSync(file); } catch { return false; }
    const ino = Number(st.ino);
    const rec = this.cache.file(file);
    const reset = Boolean(rec && (rec.ino !== ino || st.size < rec.offset));
    const offset = rec && !reset ? rec.offset : 0;
    if (rec && !reset && st.size === offset) return false;
    const r = readLines<unknown>(file, offset);
    r.items.forEach((item, i) => {
      const x = (item && typeof item === 'object' ? item : {}) as { id?: unknown; kind?: unknown; ts?: unknown };
      const id = typeof x.id === 'string' && x.id ? x.id : `~line:${file}:${r.offsets[i]}`;
      this.cache.insertEvent({ id, repo_hash: hash, run_id: runId, kind: typeof x.kind === 'string' ? x.kind : null, ts: typeof x.ts === 'string' ? x.ts : null, json: JSON.stringify(item) });
    });
    for (const s of r.skipped) {
      this.cache.insertEvent({ id: `~skipped:${file}:${s.offset}`, repo_hash: hash, run_id: runId, kind: '~skipped', ts: null, json: null });
      this.log(`skipped an unparsable line at ${file}:${s.offset}: ${s.error}`);
    }
    this.cache.setFile(file, r.offset, ino);
    return reset || !rec || r.items.length > 0 || r.skipped.length > 0;
  }

  // One synchronous pass over every run. Lanes whose projection changed share one new cursor.
  scan(): ScanResult {
    const result: ScanResult = { changed: [], removed: [] };
    this.cache.transaction(() => {
      const before = this.cache.cursor();
      const seen = new Set<string>();
      const touched: { hash: string; runId: string }[] = [];
      const home = factoryHome();
      for (const hash of dirs(home)) {
        if (!existsSync(runsDir(hash))) continue;
        for (const runId of dirs(runsDir(hash))) {
          if (!existsSync(commandsFile(hash, runId))) continue;
          seen.add(`${hash}/${runId}`);
          let t = false;
          for (const f of this.files(hash, runId)) t = this.ingest(f, hash, runId) || t;
          if (t || !this.cache.run(hash, runId)) touched.push({ hash, runId });
        }
      }
      const lanes: { hash: string; runId: string; lane: Lane; json: string }[] = [];
      for (const { hash, runId } of touched) {
        const lane = projectRun(loadRun(hash, runId), { repo_hash: hash, run_id: runId });
        const json = JSON.stringify(lane);
        if (this.cache.run(hash, runId)?.projection !== json) lanes.push({ hash, runId, lane, json });
      }
      for (const row of this.cache.runs()) {
        if (seen.has(`${row.repo_hash}/${row.run_id}`)) continue;
        this.cache.deleteRun(row.repo_hash, row.run_id);
        this.cache.dropFilesUnder(runDir(row.repo_hash, row.run_id) + sep);
        result.removed.push({ repo_hash: row.repo_hash, run_id: row.run_id });
      }
      if (!lanes.length) return;
      const now = this.cache.cursor();
      const cursor = now > before ? now : this.cache.bump(lanes[0].hash, lanes[0].runId, 'change');
      for (const l of lanes) {
        this.cache.setRun({ repo_hash: l.hash, run_id: l.runId, cursor, projection: l.json });
        result.changed.push({ repo_hash: l.hash, run_id: l.runId, cursor, lane: l.lane });
      }
    });
    return result;
  }

  private run(): void {
    let r: ScanResult;
    try { r = this.scan(); } catch (e) { this.log(`scan failed: ${(e as Error)?.stack ?? e}`); return; }
    if (r.changed.length || r.removed.length) this.onScan(r);
  }

  private schedule(): void {
    if (this.debounce) return;
    this.debounce = setTimeout(() => { this.debounce = null; this.run(); }, DEBOUNCE_MS);
  }

  private ensureWatch(): void {
    if (this.watcher) return;
    try {
      this.watcher = watch(factoryHome(), { recursive: true }, (_ev, name) => {
        // Only run files matter; artifacts/ and everything else are never read.
        if (!name || (String(name).endsWith('.jsonl') && String(name).split(sep).includes('runs'))) this.schedule();
      });
      this.watcher.on('error', () => { this.watcher?.close(); this.watcher = null; });
    } catch {
      this.watcher = null; // the poll covers it and retries the watch
    }
  }

  start(): void {
    this.ensureWatch();
    this.poll = setInterval(() => { this.ensureWatch(); this.run(); }, DASHBOARD_POLL_MS);
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.poll) clearInterval(this.poll);
    if (this.debounce) clearTimeout(this.debounce);
    this.poll = this.debounce = null;
  }
}
