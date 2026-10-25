// Decision grammar (Consistency Conventions) and the transcript turn matcher (AD-6). Pure: no I/O.
import type { DecisionKind, Envelope, Stage } from './events.ts';
import { STAGES } from './events.ts';
import { redactString } from './redact.ts';

export interface ParsedDecision { kind: DecisionKind; data: Record<string, unknown>; run_id?: string }

export type Parsed =
  | { decision: ParsedDecision }
  | { intent: 'start'; task: string }
  | { intent: 'resume'; run_id?: string }
  | { intent: 'bare' };

const APPROVE: Record<string, DecisionKind> = { intake: 'intake_confirmed', gate1: 'gate_1_passed', gate2: 'gate_2_passed' };
const SLICE_RE = /^S\d+$/;
const CUT_RE = /^S\d+(?:,S\d+)*$/;
const ESC_RE = /^E\d+$/;

// Text after the first `n` whitespace-separated tokens, trimmed.
function rest(text: string, n: number): string {
  let s = text;
  for (let i = 0; i < n; i++) s = s.replace(/^\s*\S+/, '');
  return s.trim();
}

// The first token is a subcommand only on an exact match with valid arity; otherwise the text is a task.
export function parseCommandArgs(commandArgs: string): Parsed {
  const text = commandArgs.trim();
  if (!text) return { intent: 'bare' };
  const t = text.split(/\s+/);
  const [cmd, a1] = t;
  const n = t.length;
  const d = (kind: DecisionKind, data: Record<string, unknown> = {}, run_id?: string): Parsed => ({ decision: run_id ? { kind, data, run_id } : { kind, data } });
  switch (cmd) {
    case 'approve':
      if (n === 2 && Object.hasOwn(APPROVE, a1)) return d(APPROVE[a1]);
      break;
    case 'rework':
      if (n >= 3 && (a1 === 'gate1' || a1 === 'gate2' || SLICE_RE.test(a1))) return d('rework_requested', { target: a1, note: rest(text, 2) });
      break;
    case 'cut':
      if (n === 2 && CUT_RE.test(a1)) return d('cut_decided', { cut: a1.split(',') });
      break;
    case 'keep':
      if (n === 1) return d('cut_decided', { cut: [] });
      break;
    case 'rule':
      if (n >= 3 && ESC_RE.test(a1)) return d('escalation_ruled', { escalation: a1, choice: rest(text, 2) });
      break;
    case 'choose':
      if (n === 2 && (a1 === 'a' || a1 === 'b')) return d('design_choice_made', { choice: a1 });
      break;
    case 'merge':
      if (n === 1) return d('merge_approved');
      break;
    case 'rerun': {
      const stage = n === 2 ? (STAGES as readonly string[]).find((s) => s === a1.toUpperCase()) : undefined;
      if (stage) return d('stage_rerun_requested', { stage: stage as Stage });
      break;
    }
    case 'abandon':
      if (n === 1 || n === 2) return d('run_abandoned', {}, a1);
      break;
    case 'resume':
      if (n === 1) return { intent: 'resume' };
      if (n === 2) return { intent: 'resume', run_id: a1 };
      break;
  }
  return { intent: 'start', task: text };
}

// --- transcript cross-check ------------------------------------------------------------------

const COMMAND_NAMES = ['factory', 'd2t-factory:factory'];

// The raw text of a transcript user turn: a string, or its text blocks joined.
function rawText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts = content.filter((c) => c && typeof c === 'object' && (c as { type?: unknown }).type === 'text' && typeof (c as { text?: unknown }).text === 'string');
  return parts.length ? parts.map((c) => (c as { text: string }).text).join('\n') : null;
}

// A slash command as (name, args): from the tagged parts Claude Code stores for a plugin command,
// or from plain `/<name> <args>` text. Null for anything else.
export function turnCommand(content: unknown): { name: string; args: string } | null {
  const raw = rawText(content);
  if (raw === null) return null;
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(raw);
  if (name) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw);
    return { name: name[1].trim().replace(/^\/+/, ''), args: (args ? args[1] : '').trim() };
  }
  const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(raw.trim());
  return m ? { name: m[1], args: (m[2] ?? '').trim() } : null;
}

// The args of a `/factory …` prompt text, or null when it is not one.
function promptArgs(prompt: string): string | null {
  const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(prompt.trim());
  if (!m || !COMMAND_NAMES.includes(m[1])) return null;
  return (m[2] ?? '').trim();
}

type HumanPrompt = Pick<Envelope<'human_prompt'>, 'data'> & { session?: string };
type PromptText = Pick<Envelope<'prompt_text'>, 'data'> & { session?: string };

// True only if the facts agree with each other and the transcript holds the exact human turn:
// same promptId, same sessionId, turnOrigin "human", a factory command name, and args equal to the
// prompt's. The facts were redacted when the hook wrote them, so the turn's args are redacted the
// same way (with the same `extra` values) before comparing.
export function matchTurn(lines: readonly unknown[], humanPrompt: HumanPrompt, promptText: PromptText, session: string, extra: readonly string[] = []): boolean {
  const h = humanPrompt.data;
  const p = promptText.data;
  if (!h || !p || typeof h.prompt_id !== 'string' || h.prompt_id !== p.prompt_id || typeof p.prompt !== 'string') return false;
  if (humanPrompt.session !== session || promptText.session !== session) return false;
  if (!COMMAND_NAMES.includes(String(h.command_name).replace(/^\/+/, ''))) return false;
  const want = promptArgs(p.prompt);
  if (want === null || want !== String(h.command_args).trim()) return false;
  return lines.some((l) => {
    if (!l || typeof l !== 'object') return false;
    const t = l as { type?: unknown; promptId?: unknown; sessionId?: unknown; turnOrigin?: unknown; message?: { content?: unknown } };
    if (t.type !== 'user' || t.promptId !== h.prompt_id || t.sessionId !== session || t.turnOrigin !== 'human') return false;
    const c = turnCommand(t.message?.content);
    return c !== null && COMMAND_NAMES.includes(c.name) && redactString(c.args, extra) === want;
  });
}
