// Taking the session's newest /factory prompt (AD-6, AD-26).
import { TRANSCRIPT_REREAD_MS } from '../core/config.ts';
import { matchTurn, parseCommandArgs, type Parsed } from '../core/decision.ts';
import { FactoryError } from '../core/errors.ts';
import { readRedactValues } from '../store/load-run.ts';
import {
  claimConsumed, consumeWithoutCommand, isConsumed, locateTranscript, readInbox, readSessionFile, readTranscript, releaseConsumed,
  setConsumedReason, type HumanPromptFact, type PromptGroup, type PromptTextFact,
} from '../store/sessions.ts';

export interface Prompt { prompt_id: string; human: HumanPromptFact; text: PromptTextFact; parsed: Parsed; older: PromptGroup[] }

export const MISMATCH = 'UNVERIFIED · transcript mismatch';

const sleepSync = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

// The newest unconsumed prompt, verified against the session's own transcript. A newest group
// still missing a fact is left pending (its hooks may still be writing), and nothing is superseded:
// a newer complete group supersedes it. A complete group whose turn is not in the transcript gets
// one re-read after TRANSCRIPT_REREAD_MS (the turn may not be flushed yet); if it still fails it is
// consumed as forged, and older ones as superseded, so neither can wedge the queue.
export function newestPrompt(session: string, wait: (ms: number) => void = sleepSync): Prompt {
  const pending = readInbox(session).filter((g) => !isConsumed(g.prompt_id));
  const newest = pending.pop();
  if (!newest) throw new FactoryError('NO_HUMAN_PROMPT', `no unconsumed /factory prompt for session ${session}`);
  const { human, text } = newest;
  if (!human || !text) throw new FactoryError('NO_HUMAN_PROMPT', `prompt ${newest.prompt_id} is not fully recorded yet (left pending; a newer /factory prompt replaces it)`);
  // The hook redacted the facts with the bound run's values; the turn is redacted the same way.
  const b = readSessionFile(session);
  const extra = b ? readRedactValues(b.repo_hash, b.run_id) : [];
  const matches = (): boolean => {
    const transcript = locateTranscript(session);
    return Boolean(transcript && matchTurn(readTranscript(transcript), human, text, session, extra));
  };
  let ok = matches();
  if (!ok) {
    wait(TRANSCRIPT_REREAD_MS);
    ok = matches();
  }
  if (!ok) {
    consumeWithoutCommand(newest.prompt_id, 'forged');
    supersede(pending);
    throw new FactoryError('NO_HUMAN_PROMPT', `${MISMATCH} (prompt ${newest.prompt_id})`);
  }
  return { prompt_id: newest.prompt_id, human, text, parsed: parseCommandArgs(human.data.command_args), older: pending };
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
