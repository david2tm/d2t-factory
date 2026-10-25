// Spike instrument: every hook event appends its raw payload (plus what this hook answered)
// to ~/.factory/spike/facts.jsonl. Behaviour toggles come from ~/.factory/spike/state.json:
//   stop_block      Stop blocks unless mayStop(state)            (AD-12)
//   nudge           SessionStart injects the bound-run nudge      (AD-12)
//   guard           PreToolUse write guard                        (AD-31)
//   capture_prompts /factory prompts -> inbox                     (AD-6, AD-26)
// Failures exit 0 and go to hook-errors.log (AD-13).
// Usage (exec form): node ${CLAUDE_PLUGIN_ROOT}/bin/hook.ts <Event>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FACTS, INBOX, ERRORS, FACTORY, HOME, appendLine, now, ulid, readState, mayStop, isUnder, claimedArtifactDirs, realish, type State,
} from './common.ts';

const event = process.argv[2] ?? 'unknown';
const t0 = Date.now();

function trunc(v: any, depth = 0): any {
  if (typeof v === 'string') return v.length > 3000 ? v.slice(0, 3000) + `…[+${v.length - 3000}]` : v;
  if (Array.isArray(v)) return depth > 6 ? '[…]' : v.slice(0, 50).map((x) => trunc(x, depth + 1));
  if (v && typeof v === 'object') { if (depth > 6) return '{…}'; const o: any = {}; for (const [k, x] of Object.entries(v)) o[k] = trunc(x, depth + 1); return o; }
  return v;
}

function claudeEnv(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (/^CLAUDE/.test(k) && !/TOKEN|KEY|SECRET|AUTH/i.test(k) && v !== undefined) o[k] = v.slice(0, 200);
  return o;
}

function out(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj));
}

// AD-25 resolution. 'session' = spine-literal (session id must be bound). Spike-only
// alternatives, enabled by state.resolve: 'ppid' (same Claude process), 'cwd' (same cwd).
function boundSession(s: State, p: any): boolean {
  if (s.bound_all) return true;
  const ids = (s.bound_sessions as string[] | undefined) ?? [];
  if (p.session_id && ids.includes(p.session_id)) return true;
  if (s.resolve === 'ppid' && (s.bound_ppids as number[] | undefined)?.includes(process.ppid)) return true;
  if (s.resolve === 'cwd' && s.bound_cwd && p.cwd === s.bound_cwd) return true;
  return false;
}

function guardDecision(s: State, p: any): { deny: boolean; reason: string } {
  const tool: string = p.tool_name ?? '';
  const input = p.tool_input ?? {};
  const fromSubagent = Boolean(p.agent_id);
  const protectedRoots = [FACTORY, join(HOME, '.claude', 'projects')];
  const allowed = claimedArtifactDirs(s);
  const okPath = (fp: string): boolean => allowed.some((d) => isUnder(fp, d));
  const isProtected = (fp: string): boolean => protectedRoots.some((r) => isUnder(fp, r));

  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    const fp: string = input.file_path ?? input.notebook_path ?? '';
    if (!fp) return { deny: false, reason: 'no path' };
    const real = realish(fp);
    if (isProtected(real) && !okPath(real)) return { deny: true, reason: `factory guard: ${tool} to ${real} is outside the claimed step's artifacts dir` };
    return { deny: false, reason: `path ok (${real})` };
  }
  if (tool === 'Bash') {
    const cmd: string = input.command ?? '';
    const isFactory = /^\s*(factory|\S*\/factory)(\s|$)/.test(cmd) && !/[;&|`$<>]/.test(cmd.replace(/^\s*\S+/, '').replace(/"[^"]*"|'[^']*'/g, ''));
    if (isFactory) {
      if (fromSubagent) return { deny: true, reason: 'factory guard: agents never call factory (AD-2)' };
      return { deny: false, reason: 'factory invocation from conductor' };
    }
    // Any path-ish token that names a protected root must resolve inside a claimed artifacts dir.
    const expanded = cmd.replace(/\$\{?HOME\}?|~(?=\/)/g, HOME);
    const mentions = /\.factory|\.claude\/projects/.test(expanded);
    if (!mentions) return { deny: false, reason: 'no protected path in command text' };
    const tokens = expanded.match(/[^\s'"`;&|<>()=]*(\.factory|\.claude\/projects)[^\s'"`;&|<>()]*/g) ?? [];
    const bad = tokens.filter((t) => !(t.startsWith('/') && okPath(t)));
    if (bad.length) return { deny: true, reason: `factory guard: Bash touches protected path(s) ${bad.slice(0, 3).join(', ')}` };
    return { deny: false, reason: 'protected mentions all inside claimed artifacts' };
  }
  return { deny: false, reason: 'tool not guarded' };
}

function main(): void {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let p: any = {};
  try { p = raw ? JSON.parse(raw) : {}; } catch { p = { _unparsed: raw.slice(0, 2000) }; }
  const s = readState();
  let answer: unknown = null;
  let note = '';

  const bound = Boolean(s && boundSession(s, p));
  if (s && bound) {
    if (event === 'Stop' && s.stop_block) {
      const m = mayStop(s, p.background_tasks);
      note = m.why;
      if (!m.may) {
        answer = {
          decision: 'block',
          reason: `Factory run ${s.run_id} is in ${s.stage} with open steps; do not stop. Run \`factory next\` (Bash) and follow its output.`,
        };
      }
    }
    if (event === 'SessionStart' && s.nudge && ['startup', 'clear', 'resume'].includes(p.source)) {
      answer = {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `This session is the conductor of factory run ${s.run_id} (stage ${s.stage}). The run is not finished. Before anything else, run \`factory next\` (Bash) and follow its output.`,
          // Probe only (documented for -p): does it start a turn in an interactive session?
          ...(s.initial_user_message ? { initialUserMessage: String(s.initial_user_message) } : {}),
        },
      };
    }
    if (event === 'PreToolUse' && s.guard) {
      const g = guardDecision(s, p);
      note = g.reason;
      if (g.deny) answer = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: g.reason } };
    }
  }

  // Prompt capture always writes /factory prompts to the inbox (AD-26), bound or not.
  if (s && s.capture_prompts && p.session_id) {
    const inbox = join(INBOX, `${p.session_id}.jsonl`);
    if (event === 'UserPromptExpansion' && /^d2t-factory:factory$/.test(p.command_name ?? '')) {
      appendLine(inbox, { v: 1, id: ulid(), ts: now(), session: p.session_id, kind: 'human_prompt', actor: 'hook', corr: null, data: { prompt_id: p.prompt_id, command_name: p.command_name, command_args: p.command_args, expansion_type: p.expansion_type, transcript_path: p.transcript_path } });
    }
    if (event === 'UserPromptSubmit' && /^\/(d2t-factory:)?factory(\s|$)/.test(p.prompt ?? '')) {
      appendLine(inbox, { v: 1, id: ulid(), ts: now(), session: p.session_id, kind: 'prompt_text', actor: 'hook', corr: null, data: { prompt_id: p.prompt_id, prompt: p.prompt, transcript_path: p.transcript_path } });
    }
  }

  // AD-31 fact classification (what the real hook would emit).
  let fact_kind: string | null = null;
  if (event === 'PostToolUse') {
    const fp: string = p.tool_input?.file_path ?? '';
    fact_kind = /^(Write|Edit|MultiEdit)$/.test(p.tool_name ?? '') && s?.run_dir && fp && isUnder(fp, join(s.run_dir, 'artifacts')) ? 'output_written' : 'tool_succeeded';
  } else if (event === 'PostToolUseFailure') fact_kind = 'tool_failed';
  appendLine(FACTS, { ts: now(), event, fact_kind, session_id: p.session_id ?? null, agent_id: p.agent_id ?? null, agent_type: p.agent_type ?? null, tool_name: p.tool_name ?? null, bound, answer, note, hook_ms: Date.now() - t0, ppid: process.ppid, env: claudeEnv(), payload: trunc(p) });
  if (answer) out(answer);
}

try { main(); } catch (e) {
  try { appendLine(ERRORS, { ts: now(), event, error: String((e as Error)?.stack ?? e) }); } catch { /* ignore */ }
}
process.exit(0);
