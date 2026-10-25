// Run lock (AD-29) and atomic mkdir claims (AD-20, AD-26).
import { mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CLAIM_GRACE_MS, LOCK_WAIT_MS } from '../core/config.ts';
import { FactoryError } from '../core/errors.ts';
import { nowIso, ulid } from './ids.ts';

// `token` tells this holder's lock from a later one at the same path (absent in older locks).
interface Owner { pid: number; host: string; ts: string; token?: string }

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

// A dir whose mtime is more than CLAIM_GRACE_MS old. A missing dir is not old.
export function pastGrace(dir: string, now: number = Date.now()): boolean {
  try { return now - statSync(dir).mtimeMs > CLAIM_GRACE_MS; } catch { return false; }
}

// A lock is stale when its owner is a dead pid on this host, or when it has had no readable
// owner.json for longer than the grace period (its holder died between mkdir and the write). A
// younger lock without one counts as live: its holder is about to write it. A missing lock is not stale.
export function lockStale(dir: string): boolean {
  const owner = readOwner(dir);
  if (owner) return owner.host === hostname() && !alive(owner.pid);
  return pastGrace(dir);
}

// Breaks a stale dir (a lock or a claim) by renaming it aside. Only one breaker at a time, under
// the `${dir}.break` mkdir mutex, and only if `stale()` still holds there: a breaker that read the
// dead owner before another breaker renamed it and a new holder took the path re-reads the new
// owner and leaves that lock alone. Returns the aside path, or null when nothing was broken. A
// mutex left by a breaker that died inside it is cleared once past the grace period.
export function breakStale(dir: string, stale: () => boolean = () => lockStale(dir)): string | null {
  const mutex = `${dir}.break`;
  if (!claimDir(mutex)) {
    if (pastGrace(mutex)) { try { rmdirSync(mutex); } catch { /* another process cleared it */ } }
    return null;
  }
  try {
    if (!stale()) return null;
    const aside = `${dir}.stale-${ulid()}`;
    try {
      renameSync(dir, aside);
      return aside;
    } catch {
      return null; // gone meanwhile
    }
  } finally {
    try { rmdirSync(mutex); } catch { /* already cleared as stale */ }
  }
}

// Removes the lock only while its owner.json is still this holder's: a lock that was broken as
// stale and taken by another process is left to that process.
function release(dir: string, token: string): void {
  if (readOwner(dir)?.token !== token) return;
  rmSync(join(dir, 'owner.json'), { force: true });
  try { rmdirSync(dir); } catch { /* broken meanwhile */ }
}

export async function acquire(dir: string, waitMs: number = LOCK_WAIT_MS): Promise<() => void> {
  const start = Date.now();
  for (;;) {
    if (claimDir(dir)) {
      const token = ulid();
      writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, host: hostname(), ts: nowIso(), token }));
      return () => release(dir, token);
    }
    if (lockStale(dir) && breakStale(dir)) continue;
    if (Date.now() - start >= waitMs) {
      const owner = readOwner(dir);
      throw new FactoryError('LOCKED', `lock ${dir} held by pid ${owner?.pid ?? '?'} on ${owner?.host ?? '?'}`);
    }
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
