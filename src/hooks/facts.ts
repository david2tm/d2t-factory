// Async fact hooks (AD-13, AD-14, AD-31): one whitelisted, redacted fact per event, for bound sessions.
import { closeSync, openSync, readSync } from 'node:fs';
import { artifactsDir, isUnder, realish } from '../store/paths.ts';
import { appendFact, boundRun, compact, safeId, str, type Bound, type Payload } from './io.ts';

const FIRST_LINE_MAX = 200;
const EXIT_CODE_RE = /^Exit code (\d+)/;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const input = (p: Payload): Record<string, unknown> => (p.tool_input && typeof p.tool_input === 'object' ? (p.tool_input as Record<string, unknown>) : {});
const command = (p: Payload): string | undefined => (p.tool_name === 'Bash' ? str(input(p).command) : undefined);

function firstLine(file: string): string | undefined {
  let fd: number;
  try { fd = openSync(file, 'r'); } catch { return undefined; }
  try {
    const buf = Buffer.alloc(4 * FIRST_LINE_MAX);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString('utf8').split('\n')[0].replace(/\r$/, '').slice(0, FIRST_LINE_MAX);
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

function context(p: Payload): { b: Bound; agentId: string | undefined } | null {
  const b = boundRun(safeId(p.session_id));
  return b ? { b, agentId: str(p.agent_id) } : null;
}

export function toolSucceeded(p: Payload): void {
  const c = context(p);
  if (!c) return;
  const tool_name = str(p.tool_name) ?? 'unknown';
  const base = { tool_use_id: str(p.tool_use_id), agent_id: c.agentId };
  const fp = tool_name === 'Write' || tool_name === 'Edit' || tool_name === 'MultiEdit' ? str(input(p).file_path) : undefined;
  if (fp) {
    const real = realish(fp, str(p.cwd) ?? process.cwd());
    if (isUnder(real, realish(artifactsDir(c.b.hash, c.b.runId)))) {
      appendFact(c.b, 'output_written', compact({ path: real, ...base, first_line: firstLine(real) }), { agentId: c.agentId });
      return;
    }
  }
  appendFact(c.b, 'tool_succeeded', compact({ tool_name, ...base, command: command(p), duration_ms: num(p.duration_ms) }), { agentId: c.agentId });
}

export function toolFailed(p: Payload): void {
  const c = context(p);
  if (!c) return;
  const m = typeof p.error === 'string' ? EXIT_CODE_RE.exec(p.error) : null;
  appendFact(c.b, 'tool_failed', compact({
    tool_name: str(p.tool_name) ?? 'unknown', tool_use_id: str(p.tool_use_id), agent_id: c.agentId, command: command(p), exit_code: m ? Number(m[1]) : null,
  }), { agentId: c.agentId });
}

export function subagentStarted(p: Payload): void {
  const c = context(p);
  if (!c || !c.agentId) return;
  appendFact(c.b, 'subagent_started', compact({ agent_id: c.agentId, agent_type: str(p.agent_type) }), { agentId: c.agentId });
}

export function subagentStopped(p: Payload): void {
  const c = context(p);
  if (!c || !c.agentId) return;
  appendFact(c.b, 'subagent_stopped', compact({ agent_id: c.agentId, agent_type: str(p.agent_type), agent_transcript_path: str(p.agent_transcript_path) }), { agentId: c.agentId });
}

export function sessionEnded(p: Payload): void {
  const c = context(p);
  if (!c) return;
  appendFact(c.b, 'session_ended', compact({ reason: str(p.reason) }));
}
