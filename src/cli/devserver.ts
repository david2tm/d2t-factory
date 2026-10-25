// The run's dev server (AD-20). The CLI alone starts and kills it: the run contract's `start`,
// detached, with PORT, its pid and log in runs/<run-id>/devserver.*. Agents never touch it.
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { checkOutput } from '../core/artifacts.ts';
import { FactoryError } from '../core/errors.ts';
import type { RunState } from '../core/reducer.ts';
import { latestStep } from '../core/verify.ts';
import { loadRun } from '../store/load-run.ts';
import { withLock } from '../store/locks.ts';
import { devserverLog, devserverPid, lockDir } from '../store/paths.ts';
import type { Args } from './args.ts';
import { sha256 } from './git.ts';
import { requireHolder, requireRun, requireSession } from './resolve.ts';

interface PidFile { pid: number; port: number; start: string; started_at: string }

export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

function readPid(hash: string, runId: string): PidFile | null {
  try { return JSON.parse(readFileSync(devserverPid(hash, runId), 'utf8')) as PidFile; } catch { return null; }
}

export interface ServerSpec { start: string; worktree: string; port: number }

// Starts it unless it already runs with the same command. An old server (another command or port)
// is stopped first and waited for, so the new one doesn't race it for the port. Returns its pid.
export async function devserverUp(hash: string, runId: string, spec: ServerSpec): Promise<{ pid: number; started: boolean }> {
  const cur = readPid(hash, runId);
  if (cur && alive(cur.pid) && cur.start === spec.start && cur.port === spec.port) return { pid: cur.pid, started: false };
  if (cur) await stop(cur.pid);
  const log = devserverLog(hash, runId);
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, 'a');
  try {
    const child = spawn('sh', ['-c', spec.start], { cwd: spec.worktree, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, PORT: String(spec.port) } });
    if (!child.pid) throw new FactoryError('CHECK_FAILED', `could not start the dev server: ${spec.start}`);
    child.unref();
    writeFileSync(devserverPid(hash, runId), JSON.stringify({ pid: child.pid, port: spec.port, start: spec.start, started_at: new Date().toISOString() }) + '\n');
    return { pid: child.pid, started: true };
  } finally {
    closeSync(fd);
  }
}

export function devserverRunning(hash: string, runId: string): boolean {
  const cur = readPid(hash, runId);
  return Boolean(cur && alive(cur.pid));
}

// The server runs as its own process group (detached), so the whole group is signalled.
function killGroup(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* gone */ } }
}

// SIGTERM the group, wait up to 2 s, then SIGKILL and wait for it to go. True if it was running.
async function stop(pid: number): Promise<boolean> {
  if (!alive(pid)) return false;
  killGroup(pid);
  for (let i = 0; i < 40 && alive(pid); i++) await sleep(50);
  if (alive(pid)) killGroup(pid, 'SIGKILL');
  for (let i = 0; i < 40 && alive(pid); i++) await sleep(50);
  return true;
}

// Killed before the port is released (AD-20). Idempotent.
export async function devserverDown(hash: string, runId: string): Promise<{ pid: number | null; stopped: boolean }> {
  const cur = readPid(hash, runId);
  if (!cur) return { pid: null, stopped: false };
  const stopped = await stop(cur.pid);
  rmSync(devserverPid(hash, runId), { force: true });
  return { pid: cur.pid, stopped };
}

// The run contract the scaffolder reported, read raw from its out.md: the projection in state is
// redacted, and a redacted command must never run. Used only while the file still has the bytes
// that were reported (output.sha256).
export function contractOf(state: RunState): Record<string, unknown> | undefined {
  const sc = latestStep(state, (st) => st.role === 'scaffolder' && st.output?.status === 'DONE');
  if (!sc?.output_path) return undefined;
  let text: string;
  try { text = readFileSync(sc.output_path, 'utf8'); } catch { return undefined; }
  if (sha256(text) !== sc.output?.sha256) return undefined;
  const r = checkOutput('scaffolder', text, { port: state.port });
  return r.ok && r.status === 'DONE' ? r.front : undefined;
}

// What the dev server needs: the contract's start command, the claimed port and the worktree.
export function serverSpec(state: RunState): ServerSpec | null {
  const start = contractOf(state)?.start;
  if (typeof start !== 'string' || state.port === undefined || !state.worktree) return null;
  return { start, worktree: state.worktree, port: state.port };
}

// `factory devserver up|down`.
export async function devserver(args: Args): Promise<unknown> {
  const session = requireSession(args);
  const [action, ...extra] = args.positionals;
  if ((action !== 'up' && action !== 'down') || extra.length) throw new FactoryError('BAD_ARGS', 'usage: factory devserver up|down --session <id>');
  const { hash, runId } = requireRun(process.cwd(), session);
  const state = await withLock(lockDir(hash, runId), () => requireHolder(hash, runId, loadRun(hash, runId), session));
  if (action === 'down') return { action, ...(await devserverDown(hash, runId)) };
  const spec = serverSpec(state);
  if (!spec) throw new FactoryError('ILLEGAL_TRANSITION', 'no run contract with a start command and a claimed port yet');
  return { action, port: spec.port, ...(await devserverUp(hash, runId, spec)) };
}
