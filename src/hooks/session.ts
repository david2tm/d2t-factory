// SessionStart (AD-12, AD-19, AD-25): plugin-env.json, the /clear rebind, the session_started fact
// and the "run factory next" nudge.
import { DASHBOARD_PORT_DEFAULT } from '../core/config.ts';
import { boardStage, isTerminal, type RunState } from '../core/reducer.ts';
import { nowIso, ulid } from '../store/ids.ts';
import { loadCommands } from '../store/load-run.ts';
import { claudeIdentity, deleteSessionFile, findByIdentity, writePluginEnv, writeSessionFile } from '../store/sessions.ts';
import { appendFact, boundRun, compact, holds, safeId, str, type Bound, type Payload } from './io.ts';

const NUDGE_SOURCES = ['startup', 'clear', 'resume', 'compact'];

function port(raw: string | undefined): number {
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return n >= 1 && n <= 65535 ? n : DASHBOARD_PORT_DEFAULT;
}

// Rewritten on every SessionStart, factory session or not (AD-19).
function pluginEnv(): void {
  const env = process.env;
  writePluginEnv({
    v: 1, plugin_root: env.CLAUDE_PLUGIN_ROOT || null, plugin_data: env.CLAUDE_PLUGIN_DATA || null,
    dashboard_port: port(env.CLAUDE_PLUGIN_OPTION_DASHBOARD_PORT), written_at: nowIso(),
  });
}

const live = (s: RunState): boolean => Boolean(s.run_id) && !isTerminal(s);

// AD-25's /clear exception: exactly one session file recorded under this Claude process (pid and
// start key) whose session holds a live run. The new session takes its place; the CLI adopts it as
// session_bound on the next holder verb. `supersedes` is the run's holder, which differs from the
// old file's session only after two /clears with no factory call between them.
function rebind(session: string, p: Payload): { b: Bound; state: RunState } | null {
  const id = claudeIdentity();
  const hits: { b: Bound; state: RunState }[] = [];
  for (const c of findByIdentity(id.pid, id.start)) {
    if (c.session === session) continue;
    const b = boundRun(c.session);
    if (!b) continue;
    const state = loadCommands(b.hash, b.runId);
    if (live(state) && holds(c, state)) hits.push({ b, state });
  }
  if (hits.length !== 1) return null;
  const [{ b: old, state }] = hits;
  const supersedes = state.holder!;
  const next: Bound = { session, binding: { ...old.binding, session, supersedes }, hash: old.hash, runId: old.runId };
  // Fact first: a session file never names a fact that isn't there.
  const fact = appendFact(next, 'session_started', compact({ source: 'clear', cwd: str(p.cwd), transcript_path: str(p.transcript_path), supersedes }), { id: ulid() });
  next.binding = writeSessionFile({ session, repo_hash: old.hash, run_id: old.runId, supersedes, rebind_fact_id: fact });
  deleteSessionFile(old.session);
  return { b: next, state };
}

function nudge(b: Bound, state: RunState): unknown {
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `This session is the conductor of factory run ${b.runId} (stage ${boardStage(state)}), which is not finished. Before anything else, run \`factory next --session ${b.session}\` and follow its output.`,
    },
  };
}

export function sessionStart(p: Payload): unknown {
  pluginEnv();
  const session = safeId(p.session_id);
  if (!session) return;
  const source = str(p.source) ?? 'unknown';
  const bound = boundRun(session);
  if (!bound) {
    const r = source === 'clear' ? rebind(session, p) : null;
    return r ? nudge(r.b, r.state) : undefined;
  }
  appendFact(bound, 'session_started', compact({ source, cwd: str(p.cwd), transcript_path: str(p.transcript_path) }));
  const state = loadCommands(bound.hash, bound.runId);
  if (!NUDGE_SOURCES.includes(source) || !live(state) || !holds(bound.binding, state)) return;
  return nudge(bound, state);
}
