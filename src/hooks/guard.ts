// The PreToolUse write guard (AD-31): a tripwire, not a boundary. In a bound session it denies a
// write, or a Bash command naming a path, under factoryHome() or the Claude projects dir, except
// inside a claimed step's artifacts dir, the open INTAKE conversation's out.md dir (the conductor
// rewrites it after `done` when the human changes something), or a plain conductor `factory …` call.
// It also denies any tool call that asks to run outside the sandbox (AD-35), and, before binding,
// does only that in a session with an unconsumed /factory prompt (the conductor's decide/start).
import { homedir } from 'node:os';
import { basename, dirname } from 'node:path';
import { openSteps, type RunState } from '../core/reducer.ts';
import { isIntakeChat } from '../core/verify.ts';
import { loadCommands } from '../store/load-run.ts';
import { claudeProjectsDir, factoryHome, isUnder, realish, stepDir } from '../store/paths.ts';
import { isConsumed, readInbox } from '../store/sessions.ts';
import { boundRun, safeId, str, type Payload } from './io.ts';

// --- shell tokenizer (pure) ------------------------------------------------------------------

export interface Shell {
  words: string[]; // every word, quotes removed, ~ / $HOME / ${HOME} expanded
  commandWords: string[]; // the command word of each simple command
  redirects: string[]; // redirection targets
  operators: string[]; // control and redirection operators, newlines included
  substitution: boolean; // $( … ), `…`, <( … ) or >( … ) anywhere, even inside double quotes
  comment: boolean;
  unterminated: boolean; // an open quote at the end
  raw: string;
}

const OPERATORS = ['&>>', '<<<', '&&', '||', ';;', '|&', '>>', '>&', '<&', '<<', '<>', '>|', '&>', '<(', '>(', '|', '&', ';', '(', ')', '<', '>'];
const REDIRECTS = new Set(['&>>', '<<<', '>>', '>&', '<&', '<<', '<>', '>|', '&>', '<', '>']);
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const ID_CHAR_RE = /[A-Za-z0-9_]/;

// A conservative reading of a bash command line: enough to say whether it is one simple command
// and which words it names. It never executes or expands anything but the home directory.
export function tokenize(cmd: string, home: string = homedir()): Shell {
  const sh: Shell = { words: [], commandWords: [], redirects: [], operators: [], substitution: false, comment: false, unterminated: false, raw: cmd };
  let cur: string | null = null;
  let raw = ''; // the word's unquoted source, to spot assignments
  let atCommand = true;
  let redirectNext = false;
  const add = (s: string, r = s): void => { cur = (cur ?? '') + s; raw += r; };
  const flush = (): void => {
    if (cur === null) return;
    sh.words.push(cur);
    if (redirectNext) { sh.redirects.push(cur); redirectNext = false; } else if (atCommand && !ASSIGNMENT_RE.test(raw)) { sh.commandWords.push(cur); atCommand = false; }
    cur = null;
    raw = '';
  };
  // $HOME or ${HOME} at i (i points at `$`): the expansion and its length, else null.
  const homeVar = (i: number): number => {
    if (cmd.startsWith('${HOME}', i)) return 7;
    if (cmd.startsWith('$HOME', i) && !ID_CHAR_RE.test(cmd[i + 5] ?? '')) return 5;
    return 0;
  };

  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === ' ' || c === '\t') { flush(); i++; continue; }
    if (c === '\n') { flush(); sh.operators.push('\n'); atCommand = true; i++; continue; }
    if (c === '#' && cur === null) {
      // A comment runs to the end of its line; the newline, if any, is handled as usual.
      sh.comment = true;
      const nl = cmd.indexOf('\n', i);
      i = nl < 0 ? cmd.length : nl;
      continue;
    }
    if (c === '\\') { add(cmd[i + 1] ?? '', '\\' + (cmd[i + 1] ?? '')); i += 2; continue; }
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1);
      if (end < 0) { sh.unterminated = true; add(cmd.slice(i + 1), "'"); break; }
      add(cmd.slice(i + 1, end), "'");
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = '';
      for (; j < cmd.length && cmd[j] !== '"'; j++) {
        if (cmd[j] === '\\' && j + 1 < cmd.length) { s += cmd[++j]; continue; }
        if (cmd[j] === '`' || (cmd[j] === '$' && cmd[j + 1] === '(')) sh.substitution = true;
        const h = cmd[j] === '$' ? homeVar(j) : 0;
        if (h) { s += home; j += h - 1; continue; }
        s += cmd[j];
      }
      if (j >= cmd.length) sh.unterminated = true;
      add(s, '"');
      i = j + 1;
      continue;
    }
    if (c === '`') { sh.substitution = true; add(c); i++; continue; }
    if (c === '$') {
      if (cmd[i + 1] === '(') sh.substitution = true;
      const h = homeVar(i);
      if (h) { add(home, '$HOME'); i += h; continue; }
      add(c);
      i++;
      continue;
    }
    if (c === '~' && cur === null && (i + 1 >= cmd.length || /[\s/;|&<>()]/.test(cmd[i + 1]))) { add(home, '~'); i++; continue; }
    const op = OPERATORS.find((o) => cmd.startsWith(o, i));
    if (op) {
      flush();
      sh.operators.push(op);
      if (op === '<(' || op === '>(') sh.substitution = true;
      if (REDIRECTS.has(op)) redirectNext = true;
      else atCommand = true;
      i += op.length;
      continue;
    }
    add(c);
    i++;
  }
  flush();
  return sh;
}

// AD-31's exemption shape: one simple command whose first word is `factory`, with no operators,
// redirections or comments, and no `$(`, backtick, `<(` or `>(` anywhere in the text, quoted or not.
export function isPlainFactory(sh: Shell): boolean {
  return sh.words[0] === 'factory' && sh.commandWords.length === 1 && !sh.operators.length && !sh.substitution && !sh.comment && !sh.unterminated
    && !/\$\(|`|[<>]\(/.test(sh.raw);
}

// Does any simple command in the line run a `factory` binary?
export const callsFactory = (sh: Shell): boolean => sh.commandWords.some((w) => basename(w) === 'factory');

// Characters that end a path inside a word: `--flag=path`, `a:b`, `"$(cat /p)"`, `open("/p")`.
const PIECE_SPLIT_RE = /[\s=:,;|&<>()'"`$]+/;
const pathLike = (s: string): boolean => s.includes('/') || s.startsWith('~') || s.startsWith('.');

// The strings that may name a path: every redirection target, and each word and each piece of a
// word that has a slash or starts with ~ or a dot, also with a leading `-<letter>` flag stripped.
export function pathCandidates(sh: Shell): string[] {
  const out = new Set<string>(sh.redirects.filter(Boolean));
  for (const w of sh.words) {
    for (const piece of [w, ...w.split(PIECE_SPLIT_RE)]) {
      if (!piece) continue;
      if (pathLike(piece)) out.add(piece);
      // A path glued to a short flag: `-o/abs/path`, `-I~/x`.
      const glued = /^-[A-Za-z](.+)$/.exec(piece)?.[1];
      if (glued && pathLike(glued)) out.add(glued);
    }
  }
  return [...out];
}

// --- the decision ----------------------------------------------------------------------------

// The artifacts dirs a write may touch: each claimed step's, and the open INTAKE conversation's
// out.md dir (claimed or reported; a re-report keeps the same out.md).
export function writableDirs(state: RunState, stepDirOf: (id: string) => string): string[] {
  const claimed = state.step_order.filter((id) => state.steps[id].state === 'claimed').map(stepDirOf);
  const intake = openSteps(state).filter((st) => isIntakeChat(st) && st.state !== 'issued' && st.output_path).map((st) => dirname(st.output_path!));
  return [...new Set([...claimed, ...intake])];
}

export interface GuardContext { cwd: string; protectedRoots: string[]; allowedDirs: string[]; fromAgent: boolean }

export type GuardVerdict = { deny: false } | { deny: true; reason: string };

export const SANDBOX_DENY = "factory guard: factory sessions run every command inside the sandbox (AD-35). Report the failure as it is; don't retry outside the sandbox and don't ask the human to change sandbox or permission settings.";

function checkPaths(paths: readonly string[], ctx: GuardContext, what: string): GuardVerdict {
  for (const p of paths) {
    const real = realish(p, ctx.cwd);
    if (!ctx.protectedRoots.some((r) => isUnder(real, r))) continue;
    if (ctx.allowedDirs.some((d) => isUnder(real, d))) continue;
    return { deny: true, reason: `factory guard: ${what} touches ${real}, which is factory-owned. Write only inside your claimed step's artifacts dir; the conductor changes run state only through \`factory\`.` };
  }
  return { deny: false };
}

// Any tool that takes the flag (Bash, Monitor, PowerShell, …), from the conductor or an agent; with
// no sandbox the flag is a no-op, so the deny costs nothing.
const unsandboxed = (input: Record<string, unknown>): boolean => input.dangerouslyDisableSandbox === true;

export function decide(tool: string, input: Record<string, unknown>, ctx: GuardContext): GuardVerdict {
  if (unsandboxed(input)) return { deny: true, reason: SANDBOX_DENY };
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const fp = str(input.file_path) ?? str(input.notebook_path);
    return fp ? checkPaths([fp], ctx, tool) : { deny: false };
  }
  if (tool === 'Bash') {
    const cmd = typeof input.command === 'string' ? input.command : '';
    const sh = tokenize(cmd);
    if (ctx.fromAgent && callsFactory(sh)) return { deny: true, reason: 'factory guard: agents never call factory; only the conductor does (AD-2).' };
    if (!ctx.fromAgent && isPlainFactory(sh)) return { deny: false };
    return checkPaths(pathCandidates(sh), ctx, 'Bash');
  }
  return { deny: false };
}

// Before binding, a session is a factory session once it has a /factory prompt not yet consumed.
const pendingFactoryPrompt = (session: string | null): boolean => Boolean(session) && readInbox(session!).some((g) => !isConsumed(g.prompt_id));

export function guard(p: Payload): unknown {
  const session = safeId(p.session_id);
  const b = boundRun(session);
  const tool = str(p.tool_name) ?? '';
  const input = p.tool_input && typeof p.tool_input === 'object' ? (p.tool_input as Record<string, unknown>) : {};
  // Before the run state loads, so an unreadable log can't fail this one open. Unbound, only the
  // sandbox flag is denied, and only with a pending /factory prompt; everything else is untouched.
  if (unsandboxed(input) && (b || pendingFactoryPrompt(session))) return deny(SANDBOX_DENY);
  if (!b) return;
  const state = loadCommands(b.hash, b.runId);
  const ctx: GuardContext = {
    cwd: str(p.cwd) ?? process.cwd(),
    protectedRoots: [realish(factoryHome()), realish(claudeProjectsDir())],
    allowedDirs: writableDirs(state, (id) => stepDir(b.hash, b.runId, id)).map((d) => realish(d)),
    fromAgent: p.agent_id !== undefined && p.agent_id !== null && p.agent_id !== '',
  };
  const v = decide(tool, input, ctx);
  return v.deny ? deny(v.reason) : undefined;
}

const deny = (reason: string): unknown => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
