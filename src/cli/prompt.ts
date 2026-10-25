// Taking the session's newest /factory prompt (AD-6, AD-26).
import { matchTurn, parseCommandArgs, type Parsed } from '../core/decision.ts';
import { FactoryError } from '../core/errors.ts';
import { readRedactValues } from '../store/load-run.ts';
import {
  claimConsumed, consumeWithoutCommand, isConsumed, locateTranscript, readInbox, readSessionFile, readTranscript, releaseConsumed,
  setConsumedReason, type HumanPromptFact, type PromptGroup, type PromptTextFact,
} from '../store/sessions.ts';

export interface Prompt { prompt_id: string; human: HumanPromptFact; text: PromptTextFact; parsed: Parsed; older: PromptGroup[] }

export const MISMATCH = 'UNVERIFIED · transcript mismatch';

// The newest unconsumed prompt, verified against the session's own transcript. A prompt that fails
// the check is consumed as forged, and older ones as superseded, so neither can wedge the queue.
export function newestPrompt(session: string): Prompt {
  const pending = readInbox(session).filter((g) => !isConsumed(g.prompt_id));
  const newest = pending.pop();
  if (!newest) throw new FactoryError('NO_HUMAN_PROMPT', `no unconsumed /factory prompt for session ${session}`);
  const transcript = locateTranscript(session);
  // The hook redacted the facts with the bound run's values; the turn is redacted the same way.
  const b = readSessionFile(session);
  const extra = b ? readRedactValues(b.repo_hash, b.run_id) : [];
  const ok = Boolean(newest.human && newest.text && transcript && matchTurn(readTranscript(transcript), newest.human, newest.text, session, extra));
  if (!ok) {
    consumeWithoutCommand(newest.prompt_id, 'forged');
    supersede(pending);
    throw new FactoryError('NO_HUMAN_PROMPT', `${MISMATCH} (prompt ${newest.prompt_id})`);
  }
  return { prompt_id: newest.prompt_id, human: newest.human!, text: newest.text!, parsed: parseCommandArgs(newest.human!.data.command_args), older: pending };
}

export function supersede(older: readonly PromptGroup[]): void {
  for (const g of older) consumeWithoutCommand(g.prompt_id, 'superseded');
}

// What a consuming command embeds (AD-6, AD-26).
export const embed = (p: Prompt): { prompt_fact_id: string; human_prompt: HumanPromptFact; prompt_text: PromptTextFact } =>
  ({ prompt_fact_id: p.human.id, human_prompt: p.human, prompt_text: p.text });

// Under the run lock: mkdir the ledger entry, append, rmdir on failure, then record the reason.
export function consumeWith(p: Prompt, reason: string, append: () => void): void {
  if (!claimConsumed(p.prompt_id)) throw new FactoryError('CLAIM_TAKEN', `prompt ${p.prompt_id} is already consumed`);
  try {
    append();
  } catch (e) {
    releaseConsumed(p.prompt_id);
    throw e;
  }
  setConsumedReason(p.prompt_id, reason);
}

export function describe(parsed: Parsed): string {
  if ('decision' in parsed) return `a decision (${parsed.decision.kind})`;
  return parsed.intent === 'start' ? `a task (${parsed.task})` : parsed.intent === 'resume' ? 'a resume' : 'a bare /factory';
}
