// Hook plumbing (AD-13): the payload, output, error log, session → run resolution and the two
// writers hooks own (AD-4): per-session fact files and the inbox.
import { existsSync, readFileSync, writeSync } from 'node:fs';
import type { DataByKind, FactKind } from '../core/events.ts';
import { FACT_ACTOR, validateEvent } from '../core/events.ts';
import { redact, redactString } from '../core/redact.ts';
import type { RunState } from '../core/reducer.ts';
import { nowIso, ulid } from '../store/ids.ts';
import { appendLine } from '../store/jsonl.ts';
import { readRedactValues } from '../store/load-run.ts';
import { commandsFile, factoryHome, factsFile, hookErrorsLog, inboxFile } from '../store/paths.ts';
import { isSafeId, readSessionFile, type SessionBinding } from '../store/sessions.ts';

// The fields hooks read. Claude Code sends more; nothing else is kept (AD-14).
export interface Payload {
  session_id?: unknown; transcript_path?: unknown; cwd?: unknown; prompt_id?: unknown; prompt?: unknown;
  command_name?: unknown; command_args?: unknown; source?: unknown; reason?: unknown;
  tool_name?: unknown; tool_input?: unknown; tool_use_id?: unknown; duration_ms?: unknown; error?: unknown;
  agent_id?: unknown; agent_type?: unknown; agent_transcript_path?: unknown; background_tasks?: unknown;
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
export const safeId = (v: unknown): string | null => (isSafeId(v) ? v : null);

// Omits undefined fields, so optional data stays absent rather than null.
export function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function readPayload(): Payload {
  const raw = readFileSync(0, 'utf8');
  const p = JSON.parse(raw) as unknown;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('hook payload is not a JSON object');
  return p as Payload;
}

// One synchronous write: process.stdout is asynchronous on a macOS pipe.
export function emit(obj: unknown): void {
  const buf = Buffer.from(JSON.stringify(obj));
  let off = 0;
  while (off < buf.length) off += writeSync(1, buf, off, buf.length - off);
}

export function logError(event: string, err: unknown): void {
  try {
    if (!existsSync(factoryHome())) return;
    const error = redactString(String((err as Error)?.stack ?? err)).slice(0, 4000);
    const line: { data?: unknown } & Record<string, unknown> = { v: 1, ts: nowIso(), event, pid: process.pid, error };
    appendLine(hookErrorsLog(), line);
  } catch { /* nowhere left to report */ }
}

// --- session → run ---------------------------------------------------------------------------

export interface Bound { session: string; binding: SessionBinding; hash: string; runId: string }

// The run a session is bound to through sessions/<session>.json (AD-25), or null when unbound.
export function boundRun(session: string | null): Bound | null {
  if (!session) return null;
  const b = readSessionFile(session);
  if (!b || !isSafeId(b.repo_hash) || !isSafeId(b.run_id) || !existsSync(commandsFile(b.repo_hash, b.run_id))) return null;
  return { session, binding: { ...b, session }, hash: b.repo_hash, runId: b.run_id };
}

// The run's holder, or a session whose pending /clear rebind supersedes the holder (AD-25).
export const holds = (b: Pick<SessionBinding, 'session' | 'supersedes'>, state: RunState): boolean =>
  state.holder !== null && (state.holder === b.session || (b.supersedes !== undefined && b.supersedes === state.holder));

// --- writers ---------------------------------------------------------------------------------

function envelope<K extends FactKind>(run: string, session: string, kind: K, data: DataByKind[K], extra: readonly string[], id = ulid()) {
  const e = { v: 1, id, ts: nowIso(), run, session, kind, actor: FACT_ACTOR, corr: null, data: redact(data, extra) };
  const v = validateEvent(e);
  if (!v.ok) throw new Error(`invalid ${kind} fact: ${v.errors.join('; ')}`);
  return e;
}

// One validated, redacted append to facts/<session>-<agent_id|main>.jsonl. Returns the fact id.
export function appendFact<K extends FactKind>(b: Bound, kind: K, data: DataByKind[K], o: { agentId?: string; id?: string } = {}): string {
  if (o.agentId !== undefined && !isSafeId(o.agentId)) throw new Error(`unsafe agent_id ${JSON.stringify(o.agentId)}`);
  const e = envelope(b.runId, b.session, kind, data, readRedactValues(b.hash, b.runId), o.id);
  appendLine(factsFile(b.hash, b.runId, b.session, o.agentId ?? null), e);
  return e.id;
}

// Inbox lines predate binding, so their `run` is the placeholder readInbox also uses (AD-26).
export const INBOX_RUN = 'inbox';

export function appendInbox<K extends 'human_prompt' | 'prompt_text'>(session: string, kind: K, data: DataByKind[K]): void {
  const b = boundRun(session);
  const extra = b ? readRedactValues(b.hash, b.runId) : [];
  appendLine(inboxFile(session), envelope(INBOX_RUN, session, kind, data, extra));
}
