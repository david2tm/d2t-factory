// The dashboard server (AD-16): one per machine, bound to 127.0.0.1:<dashboard_port>. The bind is the
// lock: EADDRINUSE exits 3, and only a bound server writes dashboard.pid {pid, plugin_version, root}.
// Spawned detached by the CLI (`ensureDashboard`); never imported by it.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { DASHBOARD_PORT_DEFAULT, HEARTBEAT_INTERVAL_MS } from '../../core/config.ts';
import { signalLostCard } from '../../core/cards.ts';
import { projectBoard, type Lane } from '../../core/projection.ts';
import { nowIso } from '../../store/ids.ts';
import { cacheDb, dashboardPidFile, factoryHome } from '../../store/paths.ts';
import { pluginVersion } from '../../store/plugin.ts';
import { liveSessions, readPluginEnv } from '../../store/sessions.ts';
import { Cache } from './cache.ts';
import { Http, type BoardView } from './http.ts';
import { Tail, type ScanResult } from './tail.ts';

export const EXIT_PORT_IN_USE = 3;

const log = (msg: string): void => { process.stderr.write(`${nowIso()} ${msg}\n`); };

const port = readPluginEnv()?.dashboard_port ?? DASHBOARD_PORT_DEFAULT;
const version = pluginVersion();
const root = factoryHome();
const key = (repoHash: string, runId: string): string => `${repoHash}/${runId}`;

let cache: Cache | null = null;
let tail: Tail | null = null;
let http: Http | null = null;
let heartbeat: NodeJS.Timeout | null = null;
// SIGNAL LOST (AD-16): live only, held here, never in the cache.
const signalLost = new Map<string, boolean>();

// One `claude agents --json` lookup per evaluation pass, made only if some lane is past its deadline.
type Lookup = () => Set<string> | null;
function lookupOnce(): Lookup {
  let done = false;
  let ids: Set<string> | null = null;
  return () => {
    if (!done) { ids = liveSessions(); done = true; }
    return ids;
  };
}

// Working (not terminal, not parked), past signal_lost_at, and the holder is not listed by
// `claude agents --json`. A failed lookup (null) counts as live.
function lost(lane: Lane, now: number, live: Lookup): boolean {
  const at = lane.deadlines.signal_lost_at;
  if (lane.terminal || lane.parked || !at || now < Date.parse(at)) return false;
  if (!lane.holder) return true;
  const ids = live();
  return ids !== null && !ids.has(lane.holder);
}

function withLive(lane: Lane): Lane {
  const sl = signalLost.get(key(lane.repo_hash, lane.run_id)) ?? false;
  const needs_you = sl ? [...lane.needs_you, { ask_id: 'signal_lost', raised_at: lane.deadlines.signal_lost_at, card: signalLostCard(lane.run_id) }] : lane.needs_you;
  return { ...lane, needs_you, live: { signal_lost: sl } };
}

const lanes = (): Lane[] => (cache ? cache.runs().map((r) => JSON.parse(r.projection) as Lane) : []);

const view: BoardView = {
  cursor: () => cache?.cursor() ?? 0,
  board: () => ({ runs: projectBoard(lanes()).runs.map(withLive) }),
  lanesSince: (n) => (cache ? cache.runs().filter((r) => r.cursor > n).map((r) => ({ cursor: r.cursor, lane: withLive(JSON.parse(r.projection) as Lane) })) : []),
};

// Re-evaluates SIGNAL LOST; a flip gets a fresh cursor so a reconnecting client sees it too.
function evaluate(lane: Lane, now: number, live: Lookup): boolean {
  const k = key(lane.repo_hash, lane.run_id);
  const next = lost(lane, now, live);
  if ((signalLost.get(k) ?? false) === next) return false;
  if (next) signalLost.set(k, true); else signalLost.delete(k);
  return true;
}

function onScan(r: ScanResult): void {
  const now = Date.now();
  const live = lookupOnce();
  for (const x of r.removed) signalLost.delete(key(x.repo_hash, x.run_id));
  for (const c of r.changed) evaluate(c.lane, now, live);
  if (r.removed.length) { http?.publishBoard(); return; }
  for (const c of r.changed) http?.publishRun(c.cursor, withLive(c.lane));
}

function beat(): void {
  if (!cache) return;
  const now = Date.now();
  const live = lookupOnce();
  for (const lane of lanes()) {
    const at = lane.deadlines.signal_lost_at;
    const k = key(lane.repo_hash, lane.run_id);
    if (!signalLost.has(k) && (!at || now < Date.parse(at))) continue;
    if (!evaluate(lane, now, live)) continue;
    const cursor = cache.bump(lane.repo_hash, lane.run_id, 'live');
    cache.setRunCursor(lane.repo_hash, lane.run_id, cursor);
    http?.publishRun(cursor, withLive(lane));
  }
}

function writePid(): void {
  const file = dashboardPidFile();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ pid: process.pid, plugin_version: version, root, port }) + '\n');
  renameSync(tmp, file);
}

function removePidIfOurs(): void {
  try {
    const p = JSON.parse(readFileSync(dashboardPidFile(), 'utf8')) as { pid?: unknown };
    if (p.pid === process.pid) rmSync(dashboardPidFile(), { force: true });
  } catch { /* gone or not ours */ }
}

const server = createServer((req, res) => {
  if (http) return http.handle(req, res);
  res.writeHead(503).end();
});

let closing = false;
function shutdown(code = 0): void {
  if (closing) return;
  closing = true;
  if (heartbeat) clearInterval(heartbeat);
  tail?.stop();
  http?.close();
  removePidIfOurs();
  server.close(() => { cache?.close(); process.exit(code); });
  server.closeAllConnections();
  setTimeout(() => { cache?.close(); process.exit(code); }, 1000).unref();
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    log(`port ${port} is in use by another process`);
    process.exit(EXIT_PORT_IN_USE);
  }
  log(`server error: ${e.stack ?? e}`);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  try {
    cache = new Cache(cacheDb(), version);
    tail = new Tail(cache, onScan, log);
    http = new Http(port, view, { pid: process.pid, plugin_version: version, root });
    onScan(tail.scan());
    const now = Date.now();
    const live = lookupOnce();
    for (const lane of lanes()) evaluate(lane, now, live);
    writePid();
    tail.start();
    heartbeat = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    log(`dashboard ${version ?? '?'} on http://127.0.0.1:${port}/ (pid ${process.pid}, root ${root})`);
  } catch (e) {
    log(`startup failed: ${(e as Error)?.stack ?? e}`);
    shutdown(1);
  }
});
