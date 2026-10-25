// Throwaway tmux driver for interactive `claude` sessions (spike harness only).
// Node built-ins only. Uses a private tmux socket so the user's tmux server is untouched.
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export const TMUX = '/opt/homebrew/bin/tmux';
const SOCKET = 'factory-spike';

function tmux(args: string[]): string {
  return execFileSync(TMUX, ['-L', SOCKET, ...args], { encoding: 'utf8' });
}

// Patterns that only appear inside a Claude Code permission dialog.
const PERMISSION_PATTERNS: RegExp[] = [
  /Do you want to (proceed|make this edit|create|allow|enter|overwrite|run)/i,
  /Yes, and don.t ask again/i,
  /Yes, allow (all|reading|access)/i,
  /Allow (this|once|always)\b.*\?/i,
  /requires? (your )?(approval|permission)/i,
];
// Folder-trust dialog (not a permission prompt, but must be dismissed).
const TRUST_PATTERN = /(Do you trust the files in this folder|Yes, I trust this folder|trust this folder|Is this a project you)/i;

export function hasPermissionPrompt(pane: string): boolean {
  if (TRUST_PATTERN.test(pane)) return false;
  return PERMISSION_PATTERNS.some((p) => p.test(pane));
}

export interface StartOpts {
  name: string;
  cwd: string;
  claudeArgs: string[];
  env?: Record<string, string>;
  width?: number;
  height?: number;
}

export class Pane {
  name: string;
  log: { t: number; capture: string; label: string }[] = [];
  promptsSeen: { t: number; excerpt: string }[] = [];
  t0 = Date.now();

  constructor(name: string) {
    this.name = name;
  }

  static async start(o: StartOpts): Promise<Pane> {
    try { tmux(['kill-session', '-t', o.name]); } catch { /* none */ }
    const envPrefix = Object.entries(o.env ?? {}).map(([k, v]) => `${k}=${shq(v)}`).join(' ');
    const cmd = `${envPrefix} claude ${o.claudeArgs.map(shq).join(' ')}`.trim();
    tmux(['new-session', '-d', '-s', o.name, '-x', String(o.width ?? 220), '-y', String(o.height ?? 60), '-c', o.cwd, cmd]);
    tmux(['set-option', '-t', o.name, 'remain-on-exit', 'on']);
    const p = new Pane(o.name);
    // Dismiss folder-trust dialog if it appears; wait for the input box.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const cap = p.capture();
      if (TRUST_PATTERN.test(cap)) {
        // Default selection is "No, exit": move to "Yes, I trust this folder" first.
        if (/❯\s*No, exit/.test(cap)) { p.keys('Down'); await sleep(400); }
        if (/❯\s*Yes, I trust/.test(p.capture())) { p.keys('Enter'); await sleep(2000); }
        continue;
      }
      if (/[❯>]\s*$/m.test(cap) && /(\? for shortcuts|bypass|accept edits|plan mode|default|─{10,})/i.test(cap)) break;
      await sleep(500);
    }
    await sleep(1000);
    p.snap('started');
    return p;
  }

  capture(): string {
    return tmux(['capture-pane', '-p', '-J', '-t', this.name, '-S', '-200']);
  }

  snap(label: string): string {
    const c = this.capture();
    this.log.push({ t: Date.now() - this.t0, capture: c, label });
    if (hasPermissionPrompt(c)) this.promptsSeen.push({ t: Date.now() - this.t0, excerpt: excerptPrompt(c) });
    return c;
  }

  keys(...k: string[]): void {
    tmux(['send-keys', '-t', this.name, ...k]);
  }

  async type(text: string): Promise<void> {
    tmux(['send-keys', '-t', this.name, '-l', text]);
    await sleep(400);
    this.keys('Enter');
  }

  // Poll until `pred(capture)` is true. Records any permission prompt seen while waiting.
  async waitFor(pred: RegExp | ((cap: string) => boolean), timeoutMs: number, label = 'wait'): Promise<{ ok: boolean; capture: string; ms: number }> {
    const start = Date.now();
    const f = typeof pred === 'function' ? pred : (c: string) => pred.test(c);
    let cap = '';
    while (Date.now() - start < timeoutMs) {
      cap = this.capture();
      if (hasPermissionPrompt(cap)) {
        const ex = excerptPrompt(cap);
        if (!this.promptsSeen.some((p) => p.excerpt === ex)) this.promptsSeen.push({ t: Date.now() - this.t0, excerpt: ex });
      }
      if (f(cap)) { this.snap(label); return { ok: true, capture: cap, ms: Date.now() - start }; }
      await sleep(500);
    }
    this.snap(label + ':timeout');
    return { ok: false, capture: cap, ms: Date.now() - start };
  }

  // Idle = no spinner/"esc to interrupt" and no permission dialog, stable for `stableMs`.
  async waitIdle(timeoutMs: number, stableMs = 4000): Promise<{ ok: boolean; capture: string; prompt: boolean }> {
    const start = Date.now();
    let lastBusy = Date.now();
    let cap = '';
    while (Date.now() - start < timeoutMs) {
      cap = this.capture();
      if (hasPermissionPrompt(cap)) {
        const ex = excerptPrompt(cap);
        if (!this.promptsSeen.some((p) => p.excerpt === ex)) this.promptsSeen.push({ t: Date.now() - this.t0, excerpt: ex });
        this.snap('permission-prompt');
        return { ok: false, capture: cap, prompt: true };
      }
      if (/esc to interrupt|Running…|Thinking|tokens ·/i.test(tail(cap, 12))) lastBusy = Date.now();
      else if (Date.now() - lastBusy > stableMs) { this.snap('idle'); return { ok: true, capture: cap, prompt: false }; }
      await sleep(700);
    }
    this.snap('idle:timeout');
    return { ok: false, capture: cap, prompt: false };
  }

  kill(): void {
    try { tmux(['kill-session', '-t', this.name]); } catch { /* gone */ }
  }
}

export function killServer(): void {
  try { tmux(['kill-server']); } catch { /* none */ }
}

export function tail(s: string, n: number): string {
  return s.trimEnd().split('\n').slice(-n).join('\n');
}

export function excerptPrompt(cap: string): string {
  const lines = cap.split('\n');
  const i = lines.findIndex((l) => PERMISSION_PATTERNS.some((p) => p.test(l)));
  return lines.slice(Math.max(0, i - 6), i + 4).map((l) => l.replace(/[│╌─]+/g, ' ').trim()).filter(Boolean).join(' | ').slice(0, 600);
}

export function shq(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
