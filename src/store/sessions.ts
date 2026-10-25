// Session binding files (AD-25), the Stop hook's block counter (AD-12), the prompt inbox and
// consumption ledger (AD-26), the transcript locate (AD-6) and holder liveness.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, sep } from 'node:path';
import type { Envelope } from '../core/events.ts';
import { validateEvent } from '../core/events.ts';
import { readLines } from './jsonl.ts';
import { claimDir } from './locks.ts';
import { claudeAgentsFile, claudeProjectsDir, consumedDir, consumedReasonFile, inboxFile, pluginEnvFile, projectTranscript, sessionFile, sessionsDir, stopFile } from './paths.ts';
import { nowIso } from './ids.ts';

// Session and prompt IDs become path segments, so only plain names are accepted.
export const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const isSafeId = (s: unknown): s is string => typeof s === 'string' && SAFE_ID_RE.test(s) && !s.includes('..');

// --- session files ---------------------------------------------------------------------------

export interface SessionBinding {
  session: string;
  repo_hash: string;
  run_id: string;
  claude_pid: number | null;
  claude_start: string | null;
  bound_at: string;
  // Set only by the SessionStart(clear) rebind until the CLI adopts it as session_bound (AD-25).
  supersedes?: string;
  rebind_fact_id?: string;
}

export interface ClaudeIdentity { pid: number | null; start: string | null }

// The Claude Code process this code runs under (AD-25's /clear rebind key). CLAUDE_PID is set for
// hooks and for Bash alike. The start key is the birthtime of the process's messaging socket when
// that socket is named `<pid>.sock`, else `ps` lstart, else null. `ps` is EPERM under the sandbox,
// and the socket outlives /clear, so the socket comes first.
export function claudeIdentity(env: NodeJS.ProcessEnv = process.env): ClaudeIdentity {
  const raw = env.CLAUDE_PID;
  const pid = raw && /^\d+$/.test(raw) && Number(raw) > 1 ? Number(raw) : null;
  if (pid === null) return { pid: null, start: null };
  const sock = env.CLAUDE_CODE_MESSAGING_SOCKET;
  if (sock && basename(sock) === `${pid}.sock`) {
    try {
      const st = lstatSync(sock);
      if (st.birthtimeMs > 0) return { pid, start: `sock:${st.birthtime.toISOString()}` };
    } catch { /* fall through to ps */ }
  }
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 });
  const lstart = r.status === 0 ? r.stdout.trim().replace(/\s+/g, ' ') : '';
  return { pid, start: lstart ? `ps:${lstart}` : null };
}

type BindingInput = Pick<SessionBinding, 'session' | 'repo_hash' | 'run_id'> & Partial<Pick<SessionBinding, 'supersedes' | 'rebind_fact_id'>>;

export function writeSessionFile(b: BindingInput): SessionBinding {
  const id = claudeIdentity();
  const full: SessionBinding = { ...b, claude_pid: id.pid, claude_start: id.start, bound_at: nowIso() };
  const file = sessionFile(b.session);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(full) + '\n');
  renameSync(tmp, file);
  return full;
}

export function readSessionFile(session: string): SessionBinding | null {
  try {
    const b = JSON.parse(readFileSync(sessionFile(session), 'utf8')) as SessionBinding;
    return typeof b.repo_hash === 'string' && typeof b.run_id === 'string' ? b : null;
  } catch {
    return null;
  }
}

export function deleteSessionFile(session: string): void {
  rmSync(sessionFile(session), { force: true });
  rmSync(stopFile(session), { force: true });
}

// Session files recorded under this exact process identity. A null pid or start never matches.
export function findByIdentity(pid: number | null, start: string | null): SessionBinding[] {
  if (pid === null || start === null) return [];
  let names: string[] = [];
  try { names = readdirSync(sessionsDir()); } catch { return []; }
  const out: SessionBinding[] = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const session = n.slice(0, -'.json'.length);
    if (!isSafeId(session)) continue;
    const b = readSessionFile(session);
    if (b && b.claude_pid === pid && b.claude_start === start) out.push({ ...b, session });
  }
  return out;
}

// --- Stop block counter (6-1, AD-12) ---------------------------------------------------------

// sessions/<session>.stop: consecutive blocks, the newest main tool fact id and the last human
// transcript entry's uuid when they were counted (either changing resets the count), and the
// tool_use_ids a stop_yielded already recorded.
export interface StopCounter { blocks: number; tool_fact: string | null; human_turn: string | null; yielded: string[] }

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// The counter, or null when absent or unreadable. Malformed fields fall back to their empty value.
export function readStopFile(session: string): StopCounter | null {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(stopFile(session), 'utf8')); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const x = raw as Record<string, unknown>;
  const blocks = typeof x.blocks === 'number' && Number.isInteger(x.blocks) && x.blocks >= 0 ? x.blocks : 0;
  const yielded = Array.isArray(x.yielded) ? x.yielded.filter((y): y is string => typeof y === 'string') : [];
  return { blocks, tool_fact: strOrNull(x.tool_fact), human_turn: strOrNull(x.human_turn), yielded };
}

// Atomic, like the session file.
export function writeStopFile(session: string, c: StopCounter): void {
  const file = stopFile(session);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(c) + '\n');
  renameSync(tmp, file);
}

// --- plugin environment (AD-19) --------------------------------------------------------------

export interface PluginEnv { v: 1; plugin_root: string | null; plugin_data: string | null; dashboard_port: number; written_at: string }

// The last plugin-env.json a SessionStart wrote, or null. A dashboard_port outside 1..65535 is dropped.
export function readPluginEnv(): Partial<PluginEnv> | null {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(pluginEnvFile(), 'utf8')); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const env = { ...(raw as Partial<PluginEnv>) };
  const p = env.dashboard_port;
  if (!(typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535)) delete env.dashboard_port;
  return env;
}

export function writePluginEnv(env: PluginEnv): void {
  const file = pluginEnvFile();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(env) + '\n');
  renameSync(tmp, file);
}

// --- inbox -----------------------------------------------------------------------------------

export type HumanPromptFact = Envelope<'human_prompt'>;
export type PromptTextFact = Envelope<'prompt_text'>;

export interface PromptGroup {
  prompt_id: string;
  human?: HumanPromptFact;
  text?: PromptTextFact;
  last: number; // index of the group's first line, for "newest"
}

// The session's prompt facts grouped by prompt_id, oldest first. The first fact of each kind per
// prompt_id wins, so a later forged copy can't replace a hook-written one.
export function readInbox(session: string): PromptGroup[] {
  const groups = new Map<string, PromptGroup>();
  readLines<unknown>(inboxFile(session)).items.forEach((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const x = item as Record<string, unknown>;
    // Inbox facts may predate binding, so `run` is not required here.
    const v = validateEvent({ ...x, run: typeof x.run === 'string' && x.run ? x.run : 'inbox' });
    if (!v.ok || (v.event.kind !== 'human_prompt' && v.event.kind !== 'prompt_text')) return;
    if (v.event.session !== session) return;
    const pid = (v.event.data as { prompt_id: string }).prompt_id;
    if (!isSafeId(pid)) return;
    // `last` is set once, so a late duplicate fact can't make an older prompt the newest.
    const g = groups.get(pid) ?? { prompt_id: pid, last: i };
    if (v.event.kind === 'human_prompt') g.human ??= item as HumanPromptFact;
    else g.text ??= item as PromptTextFact;
    groups.set(pid, g);
  });
  return [...groups.values()].sort((a, b) => a.last - b.last);
}

// --- consumption ledger ----------------------------------------------------------------------

export const isConsumed = (promptId: string): boolean => existsSync(consumedDir(promptId));

// Atomic: true if this call consumed it.
export const claimConsumed = (promptId: string): boolean => claimDir(consumedDir(promptId));

// Written after the consuming command lands, so a rollback is a plain rmdir.
export function setConsumedReason(promptId: string, reason: string): void {
  writeFileSync(consumedReasonFile(promptId), reason + '\n');
}

export function consumedReason(promptId: string): string | null {
  try { return readFileSync(consumedReasonFile(promptId), 'utf8').trim(); } catch { return null; }
}

export function releaseConsumed(promptId: string): void {
  try { rmdirSync(consumedDir(promptId)); } catch { /* already gone */ }
}

// Marks a prompt consumed with a reason and no command (forged, superseded, illegal). False if it already was.
export function consumeWithoutCommand(promptId: string, reason: string): boolean {
  if (!claimConsumed(promptId)) return false;
  setConsumedReason(promptId, reason);
  return true;
}

// --- transcript ------------------------------------------------------------------------------

// `<projects>/*/<session>.jsonl` with exactly one match whose realpath lies under the projects dir.
// Never taken from a fact (AD-6).
export function locateTranscript(session: string): string | null {
  if (!isSafeId(session)) return null;
  let root: string;
  try { root = realpathSync(claudeProjectsDir()); } catch { return null; }
  let projects: string[];
  try { projects = readdirSync(claudeProjectsDir()); } catch { return null; }
  const hits = projects.map((p) => projectTranscript(p, session)).filter((f) => existsSync(f));
  if (hits.length !== 1) return null;
  try {
    const real = realpathSync(hits[0]);
    if (!real.startsWith(root + sep) || !statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

export const readTranscript = (file: string): unknown[] => readLines<unknown>(file).items;

// --- liveness --------------------------------------------------------------------------------

function agentsJson(): unknown {
  const fixture = claudeAgentsFile();
  if (fixture) return JSON.parse(readFileSync(fixture, 'utf8'));
  const r = spawnSync('claude', ['agents', '--json'], { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) throw new Error(`claude agents --json exited ${r.status}`);
  return JSON.parse(r.stdout);
}

// The session ids `claude agents --json` lists (an idle session counts), from one lookup. The shape is
// unverified: each element's sessionId/session_id is read. Null when the lookup fails: then every
// session counts as live.
export function liveSessions(): Set<string> | null {
  let data: unknown;
  try { data = agentsJson(); } catch { return null; }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data).find(Array.isArray) : undefined;
  if (!Array.isArray(list)) return null;
  const ids = new Set<string>();
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    for (const v of [(x as { sessionId?: unknown }).sessionId, (x as { session_id?: unknown }).session_id]) if (typeof v === 'string') ids.add(v);
  }
  return ids;
}

// Is `session` listed by `claude agents --json`? Any failure counts as live.
export function sessionLive(session: string): boolean {
  const live = liveSessions();
  return live === null || live.has(session);
}
