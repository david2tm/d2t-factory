// Run lock (AD-29) and atomic mkdir claims (AD-20, AD-26).
import { mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { LOCK_WAIT_MS } from '../core/config.ts';
import { FactoryError } from '../core/errors.ts';
import { nowIso, ulid } from './ids.ts';

interface Owner { pid: number; host: string; ts: string }

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readOwner(dir: string): Owner | null {
  try { return JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')) as Owner; } catch { return null; }
}

// mkdir as an atomic claim: true if this call created it.
export function claimDir(dir: string): boolean {
  mkdirSync(dirname(dir), { recursive: true });
  try {
    mkdirSync(dir);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  }
}

export async function acquire(dir: string, waitMs: number = LOCK_WAIT_MS): Promise<() => void> {
  const start = Date.now();
  for (;;) {
    if (claimDir(dir)) {
      writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, host: hostname(), ts: nowIso() }));
      return () => {
        rmSync(join(dir, 'owner.json'), { force: true });
        try { rmdirSync(dir); } catch { /* already broken as stale */ }
      };
    }
    const owner = readOwner(dir);
    // A lock whose pid is dead is broken by renaming it aside. An owner.json not yet written
    // (the holder is between mkdir and write) counts as live.
    if (owner && owner.host === hostname() && !alive(owner.pid)) {
      try { renameSync(dir, `${dir}.stale-${ulid()}`); } catch { /* another process broke it first */ }
      continue;
    }
    if (Date.now() - start >= waitMs) throw new FactoryError('LOCKED', `lock ${dir} held by pid ${owner?.pid ?? '?'} on ${owner?.host ?? '?'}`);
    await sleep(25);
  }
}

// Held only for fold → validate → append, never across a subprocess.
export async function withLock<T>(dir: string, fn: () => T | Promise<T>, waitMs?: number): Promise<T> {
  const release = await acquire(dir, waitMs);
  try {
    return await fn();
  } finally {
    release();
  }
}
