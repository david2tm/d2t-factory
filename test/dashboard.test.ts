// The dashboard server (2-1) for real: `factory dashboard` spawns it on a free port in a temp
// FACTORY_HOME; the tests read /api/board and /api/stream over HTTP. Skipped where binding a local
// port is not permitted.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { ulid } from '../src/store/ids.ts';
import { ok, run, say, world, type World } from './harness.ts';

const BIN = join(import.meta.dirname, '..', 'bin', 'factory');

const canListen = await new Promise<boolean>((resolve) => {
  const srv = createServer();
  srv.once('error', () => resolve(false));
  srv.listen(0, '127.0.0.1', () => srv.close(() => resolve(true)));
});
const LISTEN = { skip: canListen ? false : 'local port binding is not permitted here' };

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const srv = createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const p = (srv.address() as { port: number }).port; srv.close(() => resolve(p)); });
});
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Home { home: string; port: number; agents: string; env: NodeJS.ProcessEnv }
const homes: Home[] = [];
const pids = new Set<number>();
const extraPorts: number[] = []; // ports a test moved a server away from

async function makeHome(): Promise<Home> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-dash-')));
  const home = join(base, '.factory');
  mkdirSync(home);
  symlinkSync(process.execPath, join(home, 'node'));
  const port = canListen ? await freePort() : 4870; // never bound when binding is not permitted
  writeFileSync(join(home, 'plugin-env.json'), JSON.stringify({ v: 1, dashboard_port: port }) + '\n');
  const agents = join(base, 'agents.json');
  writeFileSync(agents, JSON.stringify([{ sessionId: 'live-session' }]));
  const env: NodeJS.ProcessEnv = { ...process.env, FACTORY_HOME: home, FACTORY_CLAUDE_AGENTS_JSON: agents };
  for (const k of ['FACTORY_DASHBOARD_OFF', 'FACTORY_DASHBOARD_DIST', 'CLAUDE_CODE_SESSION_ID']) delete env[k];
  const h = { home, port, agents, env };
  homes.push(h);
  return h;
}

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pidFile = (h: Home): string => join(h.home, 'dashboard.pid');
const readPid = (h: Home): any => JSON.parse(readFileSync(pidFile(h), 'utf8'));

function dashboard(h: Home): any {
  const r = spawnSync(BIN, ['dashboard', '--session', 'board-test'], { env: h.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  if (existsSync(pidFile(h))) pids.add(readPid(h).pid);
  return out;
}

async function stopServer(h: Home): Promise<void> {
  if (!existsSync(pidFile(h))) return;
  const { pid } = readPid(h);
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  for (let i = 0; i < 50 && alive(pid); i++) await sleep(50);
  assert.equal(alive(pid), false, `server ${pid} did not stop`);
}

after(async () => {
  for (const h of homes) await stopServer(h);
  for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL');
  // No test leaves a process listening.
  for (const port of [...homes.map((h) => h.port), ...extraPorts]) {
    const refused = await new Promise<boolean>((resolve) => {
      const req = request({ agent: false, host: '127.0.0.1', port, path: '/api/health', headers: { host: `127.0.0.1:${port}` } }, (res) => { res.resume(); resolve(false); });
      req.on('error', () => resolve(true));
      req.end();
    });
    assert.ok(refused, `port ${port} still answers`);
  }
});

function get(h: Home, path: string, o: { host?: string; method?: string } = {}): Promise<{ status: number; body: any; type: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ agent: false, host: '127.0.0.1', port: h.port, path, method: o.method ?? 'GET', headers: { host: o.host ?? `127.0.0.1:${h.port}` } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let body: any = data;
        try { body = JSON.parse(data); } catch { /* text */ }
        resolve({ status: res.statusCode!, body, type: String(res.headers['content-type'] ?? '') });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

interface SseEvent { event: string; id: number; data: any }

// A tiny SSE client: collects events; `next` waits for the next one that matches.
function stream(h: Home, query = '', headers: Record<string, string> = {}) {
  const events: SseEvent[] = [];
  let buf = '';
  let read = 0;
  const req = request({ agent: false, host: '127.0.0.1', port: h.port, path: `/api/stream${query}`, headers: { host: `localhost:${h.port}`, ...headers } }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (c: string) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const f: Record<string, string> = {};
        for (const line of block.split('\n')) {
          const m = /^([a-z]+): ?(.*)$/i.exec(line);
          if (m) f[m[1]] = m[2];
        }
        if (f.event) events.push({ event: f.event, id: Number(f.id), data: JSON.parse(f.data) });
      }
    });
  });
  req.on('error', () => {});
  req.end();
  return {
    events,
    async next(timeoutMs = 4000, pred: (e: SseEvent) => boolean = () => true): Promise<SseEvent> {
      for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(25)) {
        while (read < events.length) { const e = events[read++]; if (pred(e)) return e; }
      }
      throw new Error(`no SSE event within ${timeoutMs} ms (got ${events.map((e) => e.event).join(', ')})`);
    },
    close: () => req.destroy(),
  };
}

// --- runs on disk -------------------------------------------------------------------------------

const iso = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();
const ev = (run: string, kind: string, data: object, o: { ts?: string; session?: string; actor?: string } = {}): object =>
  ({ v: 1, id: ulid(), ts: o.ts ?? new Date().toISOString(), run, ...(o.session ? { session: o.session } : {}), kind, actor: o.actor ?? 'cli', corr: o.actor === 'hook' ? null : 'c', data });
const started = (run: string, hash: string, holder: string, ts: string): object[] => [
  ev(run, 'run_started', { task: `task ${run}`, repo_hash: hash, base_sha: 'b'.repeat(40), branch: `factory/${run}` }, { ts, session: holder }),
  ev(run, 'session_bound', { session: holder }, { ts, session: holder }),
];
const commandsOf = (h: Home, hash: string, run: string): string => join(h.home, hash, 'runs', run, 'commands.jsonl');
function writeRun(h: Home, hash: string, run: string, lines: string[]): void {
  mkdirSync(join(h.home, hash, 'runs', run, 'facts'), { recursive: true });
  writeFileSync(commandsOf(h, hash, run), lines.map((l) => l + '\n').join(''));
}
const line = (o: object): string => JSON.stringify(o);

const A = { hash: 'aaaaaaaaaaaa', run: 'alpha-aaaa' };
const B = { hash: 'bbbbbbbbbbbb', run: 'beta-bbbb' };
const C = { hash: 'aaaaaaaaaaaa', run: 'lost-cccc' }; // old events, its holder gone: SIGNAL LOST
const D = { hash: 'bbbbbbbbbbbb', run: 'quiet-dddd' }; // old events, its holder live: no SIGNAL LOST

let main: Home | null = null;

async function seeded(): Promise<Home> {
  if (main) return main;
  const h = await makeHome();
  const [a1, a2] = started(A.run, A.hash, 'live-session', iso(5000));
  writeRun(h, A.hash, A.run, [line(a1), 'this line is not JSON', line(a2)]);
  writeRun(h, B.hash, B.run, started(B.run, B.hash, 'live-session', iso(4000)).map(line));
  writeRun(h, C.hash, C.run, started(C.run, C.hash, 'gone-session', iso(2 * 3600_000)).map(line));
  writeRun(h, D.hash, D.run, started(D.run, D.hash, 'live-session', iso(3 * 3600_000)).map(line));
  // Facts and artifacts sit beside the commands; artifacts/ is never read.
  writeFileSync(join(h.home, A.hash, 'runs', A.run, 'facts', 'live-session-main.jsonl'),
    line(ev(A.run, 'session_started', { source: 'startup' }, { ts: iso(4500), session: 'live-session', actor: 'hook' })) + '\n');
  mkdirSync(join(h.home, A.hash, 'runs', A.run, 'artifacts'), { recursive: true });
  writeFileSync(join(h.home, A.hash, 'runs', A.run, 'artifacts', 'x.jsonl'), 'garbage\n');
  main = h;
  return h;
}

// --- tests --------------------------------------------------------------------------------------

test('board: runs under two repo hashes, newest run_started first, a bad line counted in skipped; Host and method checks; recordings 404', LISTEN, async () => {
  const h = await seeded();
  const out = dashboard(h);
  assert.deepEqual(out, { dashboard_url: `http://127.0.0.1:${h.port}/` });
  const pid = readPid(h);
  assert.deepEqual({ ...pid, pid: typeof pid.pid }, { pid: 'number', plugin_version: '0.1.0', root: h.home, port: h.port });

  const b = await get(h, '/api/board');
  assert.equal(b.status, 200);
  assert.ok(Number.isInteger(b.body.cursor) && b.body.cursor > 0);
  const runs = b.body.projection.runs;
  assert.deepEqual(runs.map((r: any) => [r.repo_hash, r.run_id]), [[B.hash, B.run], [A.hash, A.run], [C.hash, C.run], [D.hash, D.run]]);
  const a = runs[1];
  assert.equal(a.skipped, 1);
  assert.equal(a.task, `task ${A.run}`);
  assert.deepEqual(a.cards.map((c: any) => [c.id, c.column]), [['stage:INTAKE', 'in_progress']]);
  assert.equal(a.live.signal_lost, false);
  assert.ok(a.last_event_at > a.started_at, 'facts count as events');
  assert.deepEqual((await get(h, '/api/health')).body, { pid: pid.pid, plugin_version: '0.1.0', root: h.home });

  // Read only and Host-checked.
  assert.equal((await get(h, '/api/board', { host: `evil.test:${h.port}` })).status, 403);
  assert.equal((await get(h, '/api/board', { host: `127.0.0.1:${h.port + 1}` })).status, 403);
  assert.equal((await get(h, '/api/board', { host: `localhost:${h.port}` })).status, 200);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await get(h, '/api/board', { method })).status, 405, method);

  const none = await get(h, '/api/recordings/demo');
  assert.deepEqual([none.status, none.body.error.code], [404, 'RECORDING_NOT_FOUND']);
  mkdirSync(join(h.home, 'recordings', 'demo'), { recursive: true });
  writeFileSync(join(h.home, 'recordings', 'demo', 'manifest.json'), '{}\n');
  const bad = await get(h, '/api/recordings/demo');
  assert.deepEqual([bad.status, bad.body.error.code], [404, 'RECORDING_NOT_FOUND'], 'a manifest that is not v:1');
  assert.match(bad.body.error.message, /manifest v null is not 1/);
  assert.equal((await get(h, '/api/nope')).status, 404);
});

// 4-1: a recording's replay timeline, read from recordings/<name>/ only.
test('replay: GET /api/recordings/<name> serves the fixture recording\'s timeline; live changes to the same run id never reach it; every bad recording is a 404 RECORDING_NOT_FOUND with its reason', LISTEN, async () => {
  const h = await makeHome();
  const FIXREC = join(import.meta.dirname, 'fixtures', 'recordings');
  const install = (name: string, as = name): string => { const to = join(h.home, 'recordings', as); cpSync(join(FIXREC, name), to, { recursive: true }); return to; };
  for (const n of ['happy-path', 'pipeline-acceptance']) install(n);
  // A live run with the recorded run's id, under the same home.
  const live = join(h.home, 'abc123def456', 'runs', 'add-login-page-q7k2');
  mkdirSync(join(live, 'facts'), { recursive: true });
  const lines = readFileSync(join(import.meta.dirname, 'fixtures', 'happy-path.jsonl'), 'utf8').trim().split('\n');
  writeFileSync(join(live, 'commands.jsonl'), lines.slice(0, 10).join('\n') + '\n');
  dashboard(h);

  const snapshot = (name: string): unknown => JSON.parse(readFileSync(join(FIXREC, `${name}.timeline.json`), 'utf8'));
  for (const name of ['happy-path', 'pipeline-acceptance']) {
    const r = await get(h, `/api/recordings/${name}`);
    assert.deepEqual([r.status, r.type], [200, 'application/json; charset=utf-8'], name);
    assert.deepEqual(r.body, snapshot(name), `${name}: the served timeline is the committed snapshot`);
  }
  const first = await get(h, '/api/recordings/happy-path');
  assert.ok(!JSON.stringify(first.body).includes('transcript-only-happy-path'), 'nothing from transcripts/');
  assert.equal((await get(h, '/api/board')).body.projection.runs.length, 1, 'the live board shows the live run');

  // Isolation: the live run changes, then goes; the recording does not.
  appendFileSync(join(live, 'commands.jsonl'), lines.slice(10).join('\n') + '\n');
  assert.deepEqual((await get(h, '/api/recordings/happy-path')).body, first.body, 'appended');
  rmSync(live, { recursive: true });
  assert.deepEqual((await get(h, '/api/recordings/happy-path')).body, first.body, 'deleted');

  // A changed manifest (new mtime) is read again; GET only.
  const m = join(h.home, 'recordings', 'happy-path', 'manifest.json');
  writeFileSync(m, JSON.stringify({ ...JSON.parse(readFileSync(m, 'utf8')), recorded_at: '2026-10-26T08:00:00.000Z' }));
  utimesSync(m, new Date(), new Date(Date.now() + 5000));
  assert.equal((await get(h, '/api/recordings/happy-path')).body.recorded_at, '2026-10-26T08:00:00.000Z');
  assert.equal((await get(h, '/api/recordings/happy-path', { method: 'POST' })).status, 405);
  // More recordings than are kept in memory: each is still served.
  for (let i = 0; i < 10; i++) install('happy-path', `copy-${i}`);
  for (let i = 0; i < 10; i++) assert.equal((await get(h, `/api/recordings/copy-${i}`)).body.name, 'happy-path');
  assert.equal((await get(h, '/api/recordings/copy-0')).status, 200);

  const notFound = async (path: string, msg: RegExp): Promise<void> => {
    const r = await get(h, path);
    assert.deepEqual([r.status, r.body.error?.code], [404, 'RECORDING_NOT_FOUND'], path);
    assert.match(r.body.error.message, msg, path);
  };
  await notFound('/api/recordings/nope', /no recording named nope/);
  await notFound('/api/recordings/a..b', /bad recording name/);
  await notFound('/api/recordings/.hidden', /bad recording name/);
  const v2 = install('happy-path', 'v2');
  writeFileSync(join(v2, 'manifest.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(v2, 'manifest.json'), 'utf8')), v: 2 }));
  await notFound('/api/recordings/v2', /manifest v 2 is not 1/);
  const torn = install('happy-path', 'torn');
  writeFileSync(join(torn, 'manifest.json'), '{"v":1,');
  await notFound('/api/recordings/torn', /not JSON/);
  const empty = install('happy-path', 'empty');
  const run = join(empty, 'runs', 'abc123def456', 'add-login-page-q7k2');
  writeFileSync(join(run, 'commands.jsonl'), 'not json\n');
  rmSync(join(run, 'facts'), { recursive: true });
  await notFound('/api/recordings/empty', /no valid event/);
  const gone = install('happy-path', 'gone');
  rmSync(join(gone, 'runs'), { recursive: true });
  await notFound('/api/recordings/gone', /is not in the recording/);
  // A file where facts/ belongs throws while reading: a 404, and the server lives on.
  const odd = install('happy-path', 'odd');
  const oddRun = join(odd, 'runs', 'abc123def456', 'add-login-page-q7k2');
  rmSync(join(oddRun, 'facts'), { recursive: true });
  writeFileSync(join(oddRun, 'facts'), 'not a dir\n');
  await notFound('/api/recordings/odd', /unreadable: ENOTDIR/);
  assert.equal((await get(h, '/api/health')).status, 200, 'the server still answers');
});

// 2-2: the committed dashboard/dist is the SPA, served from dist and never from outside it.
test('the built SPA: / and /replay/<name> serve dashboard/dist/index.html, assets carry their type, and traversal out of dist is a 404', LISTEN, async () => {
  const dist = join(import.meta.dirname, '..', 'dashboard', 'dist');
  const index = readFileSync(join(dist, 'index.html'), 'utf8');
  const h = await seeded();
  dashboard(h);
  for (const p of ['/', '/replay/x', '/replay/demo/']) {
    const r = await get(h, p);
    assert.deepEqual([r.status, r.type, r.body], [200, 'text/html; charset=utf-8', index], p);
    assert.match(r.body, /id="app"/);
    assert.match(r.body, /<title>d2t-factory dashboard<\/title>/);
  }
  const js = /src="\/(assets\/[^"]+\.js)"/.exec(index)?.[1];
  assert.ok(js, 'index.html loads a built script');
  const a = await get(h, `/${js}`);
  assert.deepEqual([a.status, a.type], [200, 'text/javascript; charset=utf-8']);
  assert.equal(a.body, readFileSync(join(dist, js), 'utf8'));
  const css = /href="\/(assets\/[^"]+\.css)"/.exec(index)?.[1];
  assert.ok(css, 'index.html loads a built stylesheet');
  assert.equal((await get(h, `/${css}`)).type, 'text/css; charset=utf-8');
  assert.equal((await get(h, '/assets/missing.js')).status, 404);

  assert.equal((await get(h, '/assets/..%2f..%2fpackage.json')).status, 404);
  // Encoded slashes survive URL parsing, so these resolve outside dist onto real files.
  const root = join(import.meta.dirname, '..');
  const probes: [string, string][] = [
    ['/assets/..%2f..%2f..%2ftsconfig.json', join(root, 'tsconfig.json')],
    ['/..%2f..%2fsrc%2fpackage.json', join(root, 'src', 'package.json')],
    ['/assets/..%2f..%2f..%2fsrc%2fdashboard%2fweb%2fpackage.json', join(root, 'src', 'dashboard', 'web', 'package.json')],
  ];
  for (const [p, target] of probes) {
    assert.ok(existsSync(target), `${target} exists, so the probe is not vacuous`);
    const r = await get(h, p);
    assert.equal(r.status, 404, p);
    assert.equal(r.body.error?.code, 'NOT_FOUND', p);
  }
});

// Without a build (FACTORY_DASHBOARD_DIST at an empty dir): a placeholder at / and /replay/<name>, 404 elsewhere.
test('no dist: / and /replay/<name> serve the placeholder page, and other paths are a 404', LISTEN, async () => {
  const h = await makeHome();
  h.env.FACTORY_DASHBOARD_DIST = mkdtempSync(join(tmpdir(), 'factory-nodist-'));
  dashboard(h);
  for (const p of ['/', '/replay/x', '/replay/demo/']) {
    const r = await get(h, p);
    assert.deepEqual([r.status, r.type], [200, 'text/html; charset=utf-8'], p);
    assert.match(r.body, /The board UI is not built yet/, p);
    assert.doesNotMatch(r.body, /id="app"/, p);
  }
  for (const p of ['/assets/index.js', '/replay/x/y', '/replay/', '/elsewhere', '/index.html']) {
    const r = await get(h, p);
    assert.deepEqual([r.status, r.body.error?.code], [404, 'NOT_FOUND'], p);
  }
  assert.equal((await get(h, '/api/health')).status, 200, 'the API is unaffected');
});

test('signal lost: a working run silent past signal_lost_at whose holder is not in claude agents --json; a live holder keeps it', LISTEN, async () => {
  const h = await seeded();
  dashboard(h);
  const runs = (await get(h, '/api/board')).body.projection.runs;
  const c = runs.find((r: any) => r.run_id === C.run);
  const d = runs.find((r: any) => r.run_id === D.run);
  assert.equal(c.live.signal_lost, true);
  assert.equal(c.needs_you.length, 1);
  assert.deepEqual([c.needs_you[0].card.type, c.needs_you[0].card.commands], ['signal_lost', [`/factory resume ${C.run}`]]);
  assert.equal(c.needs_you[0].raised_at, c.deadlines.signal_lost_at);
  assert.equal(d.live.signal_lost, false);
  assert.deepEqual(d.needs_you, []);

  // A new command on the lost run flips it back while the server runs.
  const s = stream(h);
  await s.next(); // the board snapshot
  appendFileSync(commandsOf(h, C.hash, C.run), line(ev(C.run, 'stage_started', { stage: 'INTAKE' })) + '\n');
  const e = await s.next(4000, (x) => x.event === 'run' && x.data.run_id === C.run);
  assert.equal(e.data.live.signal_lost, false);
  assert.ok(!e.data.needs_you.some((x: any) => x.card.type === 'signal_lost'));
  s.close();
});

test('live: an appended command reaches the stream as a run event within 2.5 s; a partial line waits for its newline; reconnects replay changed lanes or send a snapshot', LISTEN, async () => {
  const h = await seeded();
  dashboard(h);
  const s = stream(h);
  const first = await s.next();
  assert.equal(first.event, 'board');
  const c0 = first.id;
  assert.equal(first.data.cursor, c0);
  assert.equal(first.data.projection.runs.length, 4);

  const cmd = line(ev(A.run, 'stage_started', { stage: 'INTAKE' }));
  appendFileSync(commandsOf(h, A.hash, A.run), cmd.slice(0, 40));
  await sleep(2500);
  assert.deepEqual(s.events.slice(1), [], 'a partial line is not an event');
  assert.equal((await get(h, '/api/board')).body.cursor, c0);

  const t0 = Date.now();
  appendFileSync(commandsOf(h, A.hash, A.run), cmd.slice(40) + '\n');
  const run = await s.next(4000, (e) => e.event === 'run');
  assert.ok(Date.now() - t0 <= 2500, `took ${Date.now() - t0} ms`);
  assert.equal(run.data.run_id, A.run);
  assert.ok(run.id > c0);
  assert.equal(run.data.last_event_at, JSON.parse(cmd).ts);
  assert.equal((await get(h, '/api/board')).body.cursor, run.id);
  s.close();

  // Last-Event-ID (or since) = N ≤ cursor: only the lanes changed after N.
  for (const [q, hd] of [['', { 'last-event-id': String(c0) }], [`?since=${c0}`, {}]] as const) {
    const r = stream(h, q, hd);
    const e = await r.next();
    assert.deepEqual([e.event, e.id, e.data.run_id], ['run', run.id, A.run]);
    await sleep(200);
    assert.equal(r.events.length, 1, 'only the changed lane');
    r.close();
  }
  // Up to date: nothing to send.
  const cur = stream(h, `?since=${run.id}`);
  await sleep(300);
  assert.deepEqual(cur.events, []);
  cur.close();
  // Unknown or ahead of the cursor: one board snapshot.
  for (const q of [`?since=${run.id + 1000}`, '?since=abc']) {
    const r = stream(h, q);
    const e = await r.next();
    assert.deepEqual([e.event, e.id, e.data.projection.runs.length], ['board', run.id, 4]);
    r.close();
  }
});

test('tail reset and run removal: a rewritten (new inode) or truncated commands.jsonl is reread from 0; a removed run dir sends a board snapshot without it', LISTEN, async () => {
  const h = await seeded();
  dashboard(h);
  const laneOf = async (run: string): Promise<any> => (await get(h, '/api/board')).body.projection.runs.find((r: any) => r.run_id === run);
  const s = stream(h);
  await s.next();
  const file = commandsOf(h, B.hash, B.run);
  const [b1, b2] = readFileSync(file, 'utf8').trim().split('\n');
  appendFileSync(file, line(ev(B.run, 'stage_started', { stage: 'INTAKE' })) + '\n');
  await s.next(4000, (x) => x.event === 'run' && x.data.run_id === B.run);

  // A new inode with shorter content: the lane is the new content (no session_bound: no holder).
  writeFileSync(`${file}.tmp`, b1 + '\n');
  renameSync(`${file}.tmp`, file);
  const r1 = await s.next(4000, (x) => x.event === 'run' && x.data.run_id === B.run);
  assert.equal(r1.data.holder, null);
  assert.equal((await laneOf(B.run)).holder, null);

  // Same inode, truncated below the stored offset after growing: reread from 0.
  writeFileSync(file, [b1, b2, line(ev(B.run, 'stage_started', { stage: 'INTAKE' }))].join('\n') + '\n');
  await s.next(4000, (x) => x.event === 'run' && x.data.run_id === B.run && x.data.holder === 'live-session');
  truncateSync(file, Buffer.byteLength(b1) + 1); // one step, to exactly the first line
  const r2 = await s.next(4000, (x) => x.event === 'run' && x.data.run_id === B.run && x.data.holder === null);
  assert.equal(r2.data.last_event_at, JSON.parse(b1).ts);

  // A removed run: one board snapshot without it.
  rmSync(join(h.home, D.hash, 'runs', D.run), { recursive: true });
  const snap = await s.next(4000, (x) => x.event === 'board');
  assert.deepEqual(snap.data.projection.runs.map((r: any) => r.run_id).sort(), [A.run, B.run, C.run].sort());
  assert.equal(await laneOf(D.run), undefined);
  s.close();
});

test('rebuild: with the server stopped and cache.sqlite deleted (or its schema changed), the board is the same', LISTEN, async () => {
  const h = await seeded();
  dashboard(h);
  const before = (await get(h, '/api/board')).body.projection;
  const cache = join(h.home, 'cache.sqlite');

  await stopServer(h);
  assert.equal(existsSync(pidFile(h)), false, 'a stopped server removes its own pid file');
  rmSync(cache);
  assert.ok(dashboard(h).dashboard_url);
  assert.deepEqual((await get(h, '/api/board')).body.projection, before);

  await stopServer(h);
  const db = new DatabaseSync(cache);
  db.exec('UPDATE meta SET schema = 0');
  db.close();
  assert.ok(dashboard(h).dashboard_url);
  const after = (await get(h, '/api/board')).body;
  assert.deepEqual(after.projection, before);
  const db2 = new DatabaseSync(cache);
  assert.deepEqual({ ...db2.prepare('SELECT schema, plugin_version FROM meta').get() }, { schema: 1, plugin_version: '0.1.0' });
  db2.close();
});

test('singleton: a second factory dashboard reuses the live server; a version or root mismatch replaces it', LISTEN, async () => {
  const h = await seeded();
  const url = dashboard(h).dashboard_url;
  const p1 = readPid(h).pid;
  assert.deepEqual(dashboard(h), { dashboard_url: url });
  assert.equal(readPid(h).pid, p1, 'no second process');
  assert.equal((await get(h, '/api/health')).body.pid, p1);

  for (const field of ['plugin_version', 'root']) {
    const old = readPid(h).pid;
    writeFileSync(pidFile(h), JSON.stringify({ ...readPid(h), [field]: 'stale' }) + '\n');
    assert.deepEqual(dashboard(h), { dashboard_url: url });
    const now = readPid(h);
    assert.notEqual(now.pid, old, field);
    assert.equal(alive(old), false, `${field} mismatch: the old server was stopped`);
    assert.deepEqual([now.plugin_version, now.root], ['0.1.0', h.home]);
    assert.equal((await get(h, '/api/health')).body.pid, now.pid);
  }
});

test('port change: with a live server, a new dashboard_port in plugin-env.json starts a server there and stops the old one', LISTEN, async () => {
  const h = await seeded();
  dashboard(h);
  const old = { pid: readPid(h).pid, port: h.port };
  const port = await freePort();
  writeFileSync(join(h.home, 'plugin-env.json'), JSON.stringify({ v: 1, dashboard_port: port }) + '\n');
  assert.deepEqual(dashboard(h), { dashboard_url: `http://127.0.0.1:${port}/` });
  assert.equal(alive(old.pid), false, 'the server on the old port was stopped');
  h.port = port;
  const now = readPid(h);
  assert.equal(now.port, port);
  assert.equal((await get(h, '/api/health')).body.pid, now.pid);
  extraPorts.push(old.port);
});

test('a stale pid file whose pid is not a dashboard is never signalled: the server is spawned beside it', LISTEN, async () => {
  const h = await makeHome();
  // This test process stands in for an unrelated process that reused the pid.
  writeFileSync(pidFile(h), JSON.stringify({ pid: process.pid, plugin_version: 'old', root: h.home, port: h.port }) + '\n');
  assert.deepEqual(dashboard(h), { dashboard_url: `http://127.0.0.1:${h.port}/` });
  assert.notEqual(readPid(h).pid, process.pid);
});

test('foreign port: a port held by another process is reported and no pid file is written', LISTEN, async () => {
  const h = await makeHome();
  const foreign: Server = createServer((sock) => sock.end());
  await new Promise<void>((r) => foreign.listen(h.port, '127.0.0.1', () => r()));
  try {
    assert.deepEqual(dashboard(h), { dashboard_url: null, dashboard_error: `port ${h.port} is in use by another process` });
    assert.equal(existsSync(pidFile(h)), false);
  } finally {
    await new Promise<void>((r) => foreign.close(() => r()));
  }
});

test('listen EPERM (a sandbox without local binding): dashboard_error names sandbox.network.allowLocalBinding; an older EPERM line in the log does not count', async () => {
  const h = await makeHome();
  // A preload that makes every listen fail with `code`, the way the Claude sandbox fails it with EPERM.
  const denying = (code: string): NodeJS.ProcessEnv => {
    const preload = join(h.home, '..', `deny-listen-${code}.mjs`);
    writeFileSync(preload, `import net from 'node:net';\nnet.Server.prototype.listen = function (port, host) { const e = Object.assign(new Error(\`listen ${code}: denied \${host}:\${port}\`), { code: '${code}', syscall: 'listen' }); process.nextTick(() => this.emit('error', e)); return this; };\n`);
    return { ...h.env, NODE_OPTIONS: `--import=${preload}` };
  };
  const ask = (env: NodeJS.ProcessEnv): any => JSON.parse(spawnSync(BIN, ['dashboard', '--session', 'board-test'], { env, encoding: 'utf8' }).stdout);
  const eperm = ask(denying('EPERM'));
  assert.equal(eperm.dashboard_url, null);
  assert.match(eperm.dashboard_error, /listen EPERM[\s\S]*sandbox\.network\.allowLocalBinding to true/);
  assert.equal(existsSync(pidFile(h)), false);
  // Another failure later: only the bytes this spawn appended count, so no sandbox hint.
  const other = ask(denying('EACCES'));
  assert.match(other.dashboard_error, /^the dashboard server exited \(1\); see /);
  assert.match(readFileSync(join(h.home, 'dashboard.log'), 'utf8'), /listen EPERM[\s\S]*listen EACCES/);
});

test('FACTORY_DASHBOARD_OFF answers dashboard_url null and starts nothing', async () => {
  const h = await makeHome();
  const r = spawnSync(BIN, ['dashboard', '--session', 'board-test'], { env: { ...h.env, FACTORY_DASHBOARD_OFF: '1' }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(r.stdout), { dashboard_url: null });
  assert.equal(existsSync(pidFile(h)), false);
  const bad = spawnSync(BIN, ['dashboard', 'extra', '--session', 'board-test'], { env: h.env, encoding: 'utf8' });
  assert.equal(JSON.parse(bad.stdout).error.code, 'BAD_ARGS');
});

test('signal lost: a failed claude agents --json lookup counts as live, so it never raises SIGNAL LOST', async () => {
  const { sessionLive } = await import('../src/store/sessions.ts');
  const h = await makeHome();
  const saved = process.env.FACTORY_CLAUDE_AGENTS_JSON;
  try {
    process.env.FACTORY_CLAUDE_AGENTS_JSON = h.agents;
    assert.equal(sessionLive('gone-session'), false, 'a readable list without the session: not live');
    writeFileSync(h.agents, 'not json');
    assert.equal(sessionLive('gone-session'), true, 'an unparsable answer counts as live');
    process.env.FACTORY_CLAUDE_AGENTS_JSON = join(h.home, 'missing.json');
    assert.equal(sessionLive('gone-session'), true, 'a failed lookup counts as live');
  } finally {
    if (saved === undefined) delete process.env.FACTORY_CLAUDE_AGENTS_JSON; else process.env.FACTORY_CLAUDE_AGENTS_JSON = saved;
  }
});

// start and resume through bin/factory with the dashboard on (the harness turns it off by default).
async function dashboardWorld(): Promise<{ w: World; h: Home }> {
  const w = world();
  delete (w.env as Record<string, string>).FACTORY_DASHBOARD_OFF;
  const port = await freePort();
  writeFileSync(join(w.home, 'plugin-env.json'), JSON.stringify({ v: 1, dashboard_port: port }) + '\n');
  const h: Home = { home: w.home, port, agents: w.agents, env: { ...process.env, ...w.env } };
  homes.push(h); // stopped and checked in after()
  return { w, h };
}

test('start and resume return the dashboard URL of the server they started (or found)', LISTEN, async () => {
  const { w, h } = await dashboardWorld();
  say(w, 'sa', 'add login');
  const s = ok(run(w, ['start', '--session', 'sa']));
  assert.equal(s.dashboard_url, `http://127.0.0.1:${h.port}/`);
  assert.equal(s.dashboard_error, undefined);
  const pid = readPid(h).pid;
  pids.add(pid);
  const runs = (await get(h, '/api/board')).body.projection.runs;
  assert.deepEqual(runs.map((r: any) => r.run_id), [s.run_id]);

  say(w, 'sb', `resume ${s.run_id}`);
  const r = ok(run(w, ['resume', s.run_id, '--session', 'sb']));
  assert.deepEqual([r.run_id, r.supersedes, r.dashboard_url], [s.run_id, 'sa', `http://127.0.0.1:${h.port}/`]);
  assert.equal(readPid(h).pid, pid, 'resume reused the running server');
});

test('a foreign process on the port never fails start or resume: dashboard_url null plus dashboard_error', LISTEN, async () => {
  const { w, h } = await dashboardWorld();
  const foreign: Server = createServer((sock) => sock.end());
  await new Promise<void>((r) => foreign.listen(h.port, '127.0.0.1', () => r()));
  try {
    say(w, 'sa', 'add login');
    const s = ok(run(w, ['start', '--session', 'sa']));
    assert.match(s.run_id, /^add-login-/);
    assert.deepEqual([s.dashboard_url, s.dashboard_error], [null, `port ${h.port} is in use by another process`]);
    say(w, 'sb', `resume ${s.run_id}`);
    const r = ok(run(w, ['resume', s.run_id, '--session', 'sb']));
    assert.deepEqual([r.run_id, r.dashboard_url, r.dashboard_error], [s.run_id, null, `port ${h.port} is in use by another process`]);
    assert.equal(existsSync(pidFile(h)), false);
  } finally {
    await new Promise<void>((r) => foreign.close(() => r()));
  }
});
