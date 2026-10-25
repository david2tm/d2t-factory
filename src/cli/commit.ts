// Building, gating and appending commands. Callers hold the run lock (AD-29) around gate + append.
import { existsSync } from 'node:fs';
import { FactoryError } from '../core/errors.ts';
import type { AnyEvent, DataByKind, Kind } from '../core/events.ts';
import { validateEvent } from '../core/events.ts';
import { apply, type RunState, type Step } from '../core/reducer.ts';
import { nowIso, ulid } from '../store/ids.ts';
import { appendLine } from '../store/jsonl.ts';
import { commandsFile, factoryHome, nodeLink, pluginEnvFile } from '../store/paths.ts';

export function makeEvent<K extends Kind>(run: string, kind: K, data: DataByKind[K], o: { session?: string; actor?: string; corr: string; id?: string }): AnyEvent {
  const e = { v: 1, id: o.id ?? ulid(), ts: nowIso(), run, ...(o.session ? { session: o.session } : {}), kind, actor: o.actor ?? 'cli', corr: o.corr, data };
  const v = validateEvent(e);
  if (!v.ok) throw new FactoryError('BAD_ARGS', `invalid ${kind}: ${v.errors.join('; ')}`);
  return v.event;
}

// `apply` each event in order; all must be legal.
export function gate(state: RunState, events: readonly AnyEvent[]): { ok: true; state: RunState } | { ok: false; reason: string } {
  let s = state;
  for (const e of events) {
    const r = apply(s, e);
    if (!r.ok) return { ok: false, reason: `${e.kind}: ${r.reason}` };
    s = r.state;
  }
  return { ok: true, state: s };
}

export function gateOrThrow(state: RunState, events: readonly AnyEvent[]): RunState {
  const g = gate(state, events);
  if (!g.ok) throw new FactoryError('ILLEGAL_TRANSITION', g.reason);
  return g.state;
}

export function appendAll(hash: string, runId: string, events: readonly AnyEvent[]): void {
  for (const e of events) appendLine(commandsFile(hash, runId), e);
}

// The step as `next` and `status` show it (AD-3). enter_worktree and exit_worktree carry the path.
export function stepView(st: Step, state?: RunState): Record<string, unknown> {
  const v: Record<string, unknown> = { step_id: st.id, kind: st.kind, stage: st.stage, attempt: st.attempt };
  for (const k of ['agent', 'agent_id', 'slice', 'check', 'brief_path', 'output_path', 'card'] as const) if (st[k] !== undefined) v[k] = st[k];
  if ((st.kind === 'enter_worktree' || st.kind === 'exit_worktree') && state?.worktree) v.path = state.worktree;
  return v;
}

// AD-35: `start` refuses until setup has run and the session has written plugin-env.json.
export function requireSetup(): void {
  if (!existsSync(factoryHome()) || !existsSync(nodeLink())) throw new FactoryError('SETUP_REQUIRED', `${factoryHome()} or its node link is missing: run factory setup in your own terminal`);
  if (!existsSync(pluginEnvFile())) throw new FactoryError('SETUP_REQUIRED', `${pluginEnvFile()} is missing: restart the session`);
}
