// Prompt capture (AD-6, AD-26): typed /factory prompts go to the inbox, bound or not.
import { appendInbox, compact, safeId, str, type Payload } from './io.ts';

// AD-6: prompts starting `/factory` or `/d2t-factory:factory`. A `<task-notification>` wake-up never does.
const FACTORY_PROMPT_RE = /^\/(?:d2t-factory:)?factory(?:\s|$)/;
const COMMAND_NAME = 'd2t-factory:factory';

export function promptSubmit(p: Payload): void {
  const session = safeId(p.session_id);
  const prompt_id = safeId(p.prompt_id);
  if (!session || !prompt_id || typeof p.prompt !== 'string' || !FACTORY_PROMPT_RE.test(p.prompt)) return;
  appendInbox(session, 'prompt_text', compact({ prompt_id, prompt: p.prompt, transcript_path: str(p.transcript_path) }));
}

export function promptExpansion(p: Payload): void {
  const session = safeId(p.session_id);
  const prompt_id = safeId(p.prompt_id);
  if (!session || !prompt_id || p.command_name !== COMMAND_NAME) return;
  const command_args = typeof p.command_args === 'string' ? p.command_args : '';
  appendInbox(session, 'human_prompt', compact({ prompt_id, command_name: COMMAND_NAME, command_args, transcript_path: str(p.transcript_path) }));
}
