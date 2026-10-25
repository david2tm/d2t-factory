// cache.sqlite (AD-1, AD-16): a rebuildable cache, opened only by the dashboard server. Deleting it,
// or a schema or plugin version change, rebuilds the same board from the JSONL files.
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const CACHE_SCHEMA = 1;

export interface FileRow { offset: number; ino: number }
export interface RunRow { repo_hash: string; run_id: string; cursor: number; projection: string }

const TABLES = `
CREATE TABLE meta(schema INTEGER NOT NULL, plugin_version TEXT);
CREATE TABLE files(path TEXT PRIMARY KEY, offset INTEGER NOT NULL, ino INTEGER NOT NULL);
CREATE TABLE events(cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, repo_hash TEXT NOT NULL, run_id TEXT NOT NULL, kind TEXT, ts TEXT, json TEXT);
CREATE TABLE runs(repo_hash TEXT NOT NULL, run_id TEXT NOT NULL, cursor INTEGER NOT NULL, projection TEXT NOT NULL, PRIMARY KEY(repo_hash, run_id));
`;

export class Cache {
  private db: DatabaseSync;
  private synthetic = 0;

  constructor(file: string, pluginVersion: string | null) {
    mkdirSync(dirname(file), { recursive: true });
    try {
      this.db = Cache.open(file, pluginVersion);
    } catch {
      // An unreadable or corrupt file is only a cache: start over.
      for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) rmSync(f, { force: true });
      this.db = Cache.open(file, pluginVersion);
    }
  }

  private static open(file: string, pluginVersion: string | null): DatabaseSync {
    const db = new DatabaseSync(file);
    let meta: { schema?: unknown; plugin_version?: unknown } | undefined;
    try { meta = db.prepare('SELECT schema, plugin_version FROM meta').get() as typeof meta; } catch { meta = undefined; }
    if (!meta || meta.schema !== CACHE_SCHEMA || (meta.plugin_version ?? null) !== pluginVersion) {
      db.exec('DROP TABLE IF EXISTS meta; DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS runs;');
      db.exec(TABLES);
      db.prepare('INSERT INTO meta(schema, plugin_version) VALUES (?, ?)').run(CACHE_SCHEMA, pluginVersion);
    }
    return db;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  file(path: string): FileRow | undefined {
    return this.db.prepare('SELECT offset, ino FROM files WHERE path = ?').get(path) as FileRow | undefined;
  }

  setFile(path: string, offset: number, ino: number): void {
    this.db.prepare('INSERT INTO files(path, offset, ino) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET offset = excluded.offset, ino = excluded.ino').run(path, offset, ino);
  }

  dropFilesUnder(dir: string): void {
    this.db.prepare('DELETE FROM files WHERE substr(path, 1, ?) = ?').run(dir.length, dir);
  }

  // True when the event is new (INSERT OR IGNORE by id).
  insertEvent(e: { id: string; repo_hash: string; run_id: string; kind: string | null; ts: string | null; json: string | null }): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO events(id, repo_hash, run_id, kind, ts, json) VALUES (?, ?, ?, ?, ?, ?)').run(e.id, e.repo_hash, e.run_id, e.kind, e.ts, e.json);
    return Number(r.changes) > 0;
  }

  cursor(): number {
    const r = this.db.prepare('SELECT max(cursor) AS c FROM events').get() as { c: number | null } | undefined;
    return Number(r?.c ?? 0);
  }

  // A fresh cursor for a lane change no line accounts for (a reset file, a skipped line seen again, a
  // live overlay flip): a marker row, so the cursor only ever grows.
  bump(repoHash: string, runId: string, why: string): number {
    const id = `~${why}:${repoHash}/${runId}:${process.pid}:${Date.now()}:${++this.synthetic}`;
    const r = this.db.prepare('INSERT INTO events(id, repo_hash, run_id, kind, ts, json) VALUES (?, ?, ?, ?, NULL, NULL)').run(id, repoHash, runId, `~${why}`);
    return Number(r.lastInsertRowid);
  }

  run(repoHash: string, runId: string): RunRow | undefined {
    return this.db.prepare('SELECT repo_hash, run_id, cursor, projection FROM runs WHERE repo_hash = ? AND run_id = ?').get(repoHash, runId) as RunRow | undefined;
  }

  setRun(row: RunRow): void {
    this.db.prepare('INSERT INTO runs(repo_hash, run_id, cursor, projection) VALUES (?, ?, ?, ?) ON CONFLICT(repo_hash, run_id) DO UPDATE SET cursor = excluded.cursor, projection = excluded.projection')
      .run(row.repo_hash, row.run_id, row.cursor, row.projection);
  }

  setRunCursor(repoHash: string, runId: string, cursor: number): void {
    this.db.prepare('UPDATE runs SET cursor = ? WHERE repo_hash = ? AND run_id = ?').run(cursor, repoHash, runId);
  }

  deleteRun(repoHash: string, runId: string): void {
    this.db.prepare('DELETE FROM runs WHERE repo_hash = ? AND run_id = ?').run(repoHash, runId);
  }

  runs(): RunRow[] {
    return this.db.prepare('SELECT repo_hash, run_id, cursor, projection FROM runs ORDER BY cursor, repo_hash, run_id').all() as unknown as RunRow[];
  }

  close(): void {
    try { this.db.close(); } catch { /* already closed */ }
  }
}
