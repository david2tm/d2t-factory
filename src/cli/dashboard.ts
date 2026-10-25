// `factory dashboard` and ensureDashboard (AD-16): find or start the machine's one dashboard server.
// The CLI never imports the server; it spawns it by path. A dashboard failure never fails the verb
// that asked for it: the answer is then dashboard_url null plus dashboard_error.
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DASHBOARD_PORT_DEFAULT } from '../core/config.ts';
import { FactoryError } from '../core/errors.ts';
import { dashboardLog, dashboardPidFile, dashboardServerEntry, factoryHome } from '../store/paths.ts';
import { pluginVersion } from '../store/plugin.ts';
import { readPluginEnv } from '../store/sessions.ts';
import type { Args } from './args.ts';
import { requireSession } from './resolve.ts';

export interface DashboardAnswer { dashboard_url: string | null; dashboard_error?: string }

const HEALTH_TIMEOUT_MS = 1000;
const STOP_WAIT_MS = 2000;
const START_WAIT_MS = 3000;
const POLL_MS = 100;
// main.ts exits with this when the port is taken (it cannot be imported from here).
const EXIT_PORT_IN_USE = 3;

// `port` is the port the server bound, so a port change in plugin-env.json can still find it.
interface PidFile { pid: number; plugin_version: string | null; root: string; port?: number }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function readPid(): PidFile | null {
  try {
    const p = JSON.parse(readFileSync(dashboardPidFile(), 'utf8')) as Partial<PidFile>;
    if (!(typeof p.pid === 'number' && Number.isInteger(p.pid) && p.pid > 0)) return null;
    return { pid: p.pid, plugin_version: p.plugin_version ?? null, root: String(p.root ?? ''), ...(typeof p.port === 'number' ? { port: p.port } : {}) };
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

async function health(port: number): Promise<{ pid?: unknown } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return r.ok ? ((await r.json()) as { pid?: unknown }) : null;
  } catch {
    return null;
  }
}

async function stop(pid: number): Promise<void> {
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  for (const end = Date.now() + STOP_WAIT_MS; Date.now() < end && alive(pid);) await sleep(POLL_MS);
  if (!alive(pid)) return;
  try { process.kill(pid, 'SIGKILL'); } catch { return; }
  for (const end = Date.now() + STOP_WAIT_MS; Date.now() < end && alive(pid);) await sleep(POLL_MS);
}

async function ensure(): Promise<DashboardAnswer> {
  const port = readPluginEnv()?.dashboard_port ?? DASHBOARD_PORT_DEFAULT;
  const url = `http://127.0.0.1:${port}/`;
  const version = pluginVersion();
  const root = factoryHome();

  // 1-2. Only a pid that /api/health confirms on its own port is a dashboard; anything else is a stale
  // pid file (the OS may have reused the pid) and is never signalled. A confirmed server of this
  // version, root and port is the one; any other confirmed one is stopped.
  const p = readPid();
  if (p && alive(p.pid) && (await health(p.port ?? port))?.pid === p.pid) {
    if (p.plugin_version === version && p.root === root && (p.port ?? port) === port) return { dashboard_url: url };
    await stop(p.pid);
  }

  // 3. Spawn it detached, its output to dashboard.log, and wait for its own pid on /api/health.
  mkdirSync(dirname(dashboardLog()), { recursive: true });
  const logFd = openSync(dashboardLog(), 'a');
  let exited: number | null | undefined;
  let child;
  try {
    child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', dashboardServerEntry()], { cwd: factoryHome(), detached: true, stdio: ['ignore', logFd, logFd], env: process.env });
  } finally {
    closeSync(logFd);
  }
  child.on('error', () => { exited = -1; });
  child.on('exit', (code) => { exited = code; });
  child.unref();
  for (const end = Date.now() + START_WAIT_MS; Date.now() < end;) {
    // 4. A child that exits 3 found the port taken by something that is not a factory dashboard.
    if (exited !== undefined) {
      return { dashboard_url: null, dashboard_error: exited === EXIT_PORT_IN_USE ? `port ${port} is in use by another process` : `the dashboard server exited (${exited}); see ${dashboardLog()}` };
    }
    const h = await health(port);
    if (h?.pid === child.pid) return { dashboard_url: url };
    await sleep(POLL_MS);
  }
  if (exited === EXIT_PORT_IN_USE) return { dashboard_url: null, dashboard_error: `port ${port} is in use by another process` };
  return { dashboard_url: null, dashboard_error: `the dashboard server did not answer on port ${port} within ${START_WAIT_MS / 1000} s; see ${dashboardLog()}` };
}

// FACTORY_DASHBOARD_OFF (tests) never starts a server. Never throws.
export async function ensureDashboard(): Promise<DashboardAnswer> {
  if (process.env.FACTORY_DASHBOARD_OFF) return { dashboard_url: null };
  try {
    return await ensure();
  } catch (e) {
    return { dashboard_url: null, dashboard_error: e instanceof Error ? e.message : String(e) };
  }
}

export async function dashboard(args: Args): Promise<DashboardAnswer> {
  requireSession(args);
  if (args.positionals.length) throw new FactoryError('BAD_ARGS', 'usage: factory dashboard --session <id>');
  return ensureDashboard();
}
