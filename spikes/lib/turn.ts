// Drive one interactive turn: type a prompt, then wait for the turn to end. Any permission
// dialog seen is recorded; with approve=true it is answered "1. Yes" (never "don't ask again",
// which would write a rule into settings).
import { setTimeout as sleep } from 'node:timers/promises';
import { Pane, excerptPrompt } from './tmux.ts';
import { readFacts, type Fact } from './spike.ts';

export interface TurnResult { prompts: string[]; approved: number; stop: Fact | null; facts: Fact[]; capture: string; timedOut: boolean }

export async function turn(pane: Pane, prompt: string | null, o: { timeoutMs: number; approve: boolean }): Promise<TurnResult> {
  const from = readFacts().length;
  if (prompt !== null) await pane.type(prompt);
  const prompts: string[] = [];
  let approved = 0;
  const start = Date.now();
  let stop: Fact | null = null;
  let cap = '';
  while (Date.now() - start < o.timeoutMs) {
    cap = pane.capture();
    const fs = readFacts().slice(from);
    const perm = fs.filter((f) => f.event === 'PermissionRequest' || (f.event === 'Notification' && /permission/i.test(JSON.stringify(f.payload))));
    const dialog = /Do you want to|❯\s*1\.\s*Yes|1\.\s*Yes/.test(cap) && /(Esc to cancel|No, and tell|2\.\s*(Yes|No))/i.test(cap);
    if (dialog) {
      const ex = excerptPrompt(cap) || cap.split('\n').filter((l) => l.trim()).slice(-12).join(' | ');
      if (!prompts.includes(ex)) { prompts.push(ex); pane.snap('permission-prompt'); }
      if (o.approve) { pane.keys('1'); approved++; await sleep(2000); continue; }
      break;
    }
    void perm;
    stop = fs.find((f) => f.event === 'Stop' && !f.answer) ?? null;
    if (stop) break;
    await sleep(600);
  }
  await sleep(1500);
  const facts = readFacts().slice(from);
  // A dialog is seen both in the pane and as a PermissionRequest hook; count each dialog once.
  // Hook-only entries are added only when the hook saw more dialogs than the pane did.
  const hookReqs = facts.filter((f) => f.event === 'PermissionRequest');
  for (const f of hookReqs.slice(prompts.length)) prompts.push(`hook PermissionRequest: ${JSON.stringify(f.payload?.tool_name ?? '')} ${JSON.stringify(f.payload?.tool_input ?? {}).slice(0, 160)}`);
  return { prompts, approved, stop, facts, capture: pane.snap('turn-end'), timedOut: !stop };
}
