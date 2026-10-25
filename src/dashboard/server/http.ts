// The dashboard's HTTP surface (AD-16). GET only, Host-checked, read only: /api/health, /api/board,
// the SSE /api/stream, a recording's replay timeline (4-1), and the SPA (or a placeholder page until
// 2-2 builds it).
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import type { Board, Lane } from '../../core/projection.ts';
import { buildTimeline } from '../../core/timeline.ts';
import { dashboardDistDir, isUnder, recordingManifest } from '../../store/paths.ts';
import { loadRecording } from '../../store/recording.ts';
import { isSafeId } from '../../store/sessions.ts';

export const PING_MS = 15_000;
// Replay timelines kept in memory, by recording name and manifest mtime (recordings never change).
export const RECORDINGS_KEPT = 8;

export interface BoardView {
  cursor(): number;
  board(): Board; // live overlays applied
  lanesSince(n: number): { cursor: number; lane: Lane }[]; // live overlays applied, by cursor
}

export interface Health { pid: number; plugin_version: string | null; root: string }

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

const PLACEHOLDER = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>d2t-factory dashboard</title></head>
<body style="background:#0b0f14;color:#cfe3f0;font-family:system-ui,sans-serif;padding:2rem">
<h1>d2t-factory dashboard</h1>
<p>The board UI is not built yet. The read model is live at <a style="color:#7fd6ff" href="/api/board">/api/board</a> and <code>/api/stream</code>.</p>
</body></html>
`;

function json(res: ServerResponse, status: number, body: unknown): void {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' });
  res.end(buf);
}

const error = (res: ServerResponse, status: number, code: string, message: string): void => json(res, status, { error: { code, message } });

const sse = (event: string, id: number, data: unknown): string => `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`;

export class Http {
  private streams = new Set<ServerResponse>();
  private timelines = new Map<string, { mtime: number; body: Buffer }>(); // least recently served first
  private ping: NodeJS.Timeout;
  private port: number;
  private view: BoardView;
  private health: Health;

  constructor(port: number, view: BoardView, health: Health) {
    this.port = port;
    this.view = view;
    this.health = health;
    this.ping = setInterval(() => { for (const s of this.streams) s.write(': ping\n\n'); }, PING_MS);
  }

  // A changed lane to every open stream.
  publishRun(cursor: number, lane: Lane): void {
    const msg = sse('run', cursor, lane);
    for (const s of this.streams) s.write(msg);
  }

  // A whole snapshot, for changes a lane event cannot say (a removed run).
  publishBoard(): void {
    const msg = sse('board', this.view.cursor(), { cursor: this.view.cursor(), projection: this.view.board() });
    for (const s of this.streams) s.write(msg);
  }

  close(): void {
    clearInterval(this.ping);
    for (const s of this.streams) s.end();
    this.streams.clear();
  }

  handle = (req: IncomingMessage, res: ServerResponse): void => {
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) return error(res, 403, 'FORBIDDEN_HOST', `Host ${JSON.stringify(host)} is not 127.0.0.1:${this.port} or localhost:${this.port}`);
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      return error(res, 405, 'METHOD_NOT_ALLOWED', 'the dashboard is read only: GET only');
    }
    let url: URL;
    let path: string;
    try {
      url = new URL(req.url ?? '/', `http://${host}`);
      path = decodeURIComponent(url.pathname);
    } catch {
      return error(res, 400, 'BAD_REQUEST', 'bad URL');
    }
    if (path === '/api/health') return json(res, 200, this.health);
    if (path === '/api/board') return json(res, 200, { cursor: this.view.cursor(), projection: this.view.board() });
    if (path === '/api/stream') return this.stream(req, res, url);
    const rec = /^\/api\/recordings\/([^/]+)$/.exec(path);
    if (rec) return this.recording(res, rec[1]);
    if (path.startsWith('/api/')) return error(res, 404, 'NOT_FOUND', `no route ${path}`);
    return this.static(res, path);
  };

  // GET /api/recordings/<name> (AD-18): the recording folded by the AD-1 reducer into one ordered
  // timeline. Read from recordings/<name>/ only; nothing from transcripts/.
  private recording(res: ServerResponse, name: string): void {
    if (!isSafeId(name)) return error(res, 404, 'RECORDING_NOT_FOUND', `bad recording name ${JSON.stringify(name)}`);
    let mtime: number;
    try { mtime = statSync(recordingManifest(name)).mtimeMs; } catch { return error(res, 404, 'RECORDING_NOT_FOUND', `no recording named ${name}`); }
    let hit = this.timelines.get(name);
    if (hit && hit.mtime === mtime) {
      this.timelines.delete(name);
      this.timelines.set(name, hit);
    } else {
      let body: Buffer;
      try {
        const r = loadRecording(name);
        if ('missing' in r) return error(res, 404, 'RECORDING_NOT_FOUND', r.missing);
        const t = buildTimeline(r.manifest, r.runs);
        if (!t.events.length) return error(res, 404, 'RECORDING_NOT_FOUND', `recording ${name}: no valid event`);
        body = Buffer.from(JSON.stringify(t));
      } catch (e) {
        // An unreadable tree (a file where a dir belongs, a file without read permission) is not a recording.
        return error(res, 404, 'RECORDING_NOT_FOUND', `recording ${name} is unreadable: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
      }
      hit = { mtime, body };
      this.timelines.delete(name);
      this.timelines.set(name, hit);
      while (this.timelines.size > RECORDINGS_KEPT) this.timelines.delete(this.timelines.keys().next().value!);
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': hit.body.length, 'cache-control': 'no-store' });
    res.end(hit.body);
  }

  private stream(req: IncomingMessage, res: ServerResponse, url: URL): void {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 2000\n\n');
    const raw = req.headers['last-event-id'] ?? url.searchParams.get('since') ?? undefined;
    const n = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
    const cursor = this.view.cursor();
    if (Number.isSafeInteger(n) && n <= cursor) {
      for (const x of this.view.lanesSince(n)) res.write(sse('run', x.cursor, x.lane));
    } else {
      res.write(sse('board', cursor, { cursor, projection: this.view.board() }));
    }
    this.streams.add(res);
    const drop = (): void => { this.streams.delete(res); };
    req.on('close', drop);
    res.on('close', drop);
  }

  // The SPA from dashboard/dist (never outside it), with /, /replay/<name> and unknown routes on
  // index.html. Without a build, a placeholder at / and /replay/<name>.
  private static(res: ServerResponse, path: string): void {
    const dist = resolve(dashboardDistDir());
    const index = join(dist, 'index.html');
    const spa = path === '/' || /^\/replay\/[^/]+\/?$/.test(path);
    if (!existsSync(index)) {
      if (!spa) return error(res, 404, 'NOT_FOUND', `no file ${path}`);
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
      res.end(PLACEHOLDER);
      return;
    }
    let file = spa ? index : resolve(dist, `.${path}`);
    if (path.includes('\0') || !isUnder(file, dist)) return error(res, 404, 'NOT_FOUND', `no file ${path}`);
    try {
      if (!statSync(file).isFile()) file = index;
    } catch {
      if (extname(path)) return error(res, 404, 'NOT_FOUND', `no file ${path}`);
      file = index; // a client-side route
    }
    let body: Buffer;
    try { body = readFileSync(file); } catch { return error(res, 404, 'NOT_FOUND', `no file ${path}`); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': body.length, 'cache-control': file === index ? 'no-store' : 'public, max-age=300' });
    res.end(body);
  }
}
