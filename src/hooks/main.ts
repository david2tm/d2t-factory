// `factory hook <Event>` (AD-13): one handler per event. Always exits 0; failures go to
// hook-errors.log. The only outputs are the Stop block, the guard's deny and the SessionStart nudge.
import { existsSync } from 'node:fs';
import { factoryHome } from '../store/paths.ts';
import { sessionEnded, subagentStarted, subagentStopped, toolFailed, toolSucceeded } from './facts.ts';
import { guard } from './guard.ts';
import { emit, logError, readPayload, type Payload } from './io.ts';
import { promptExpansion, promptSubmit } from './prompt.ts';
import { sessionStart } from './session.ts';
import { stop } from './stop.ts';

type Handler = (p: Payload) => unknown;

const HANDLERS: Record<string, Handler> = {
  UserPromptSubmit: promptSubmit,
  UserPromptExpansion: promptExpansion,
  SessionStart: sessionStart,
  Stop: stop,
  PreToolUse: guard,
  PostToolUse: toolSucceeded,
  PostToolUseFailure: toolFailed,
  SubagentStart: subagentStarted,
  SubagentStop: subagentStopped,
  SessionEnd: sessionEnded,
};

export async function main(argv: readonly string[]): Promise<void> {
  const event = argv[0] ?? '';
  try {
    if (!existsSync(factoryHome())) return; // not a factory machine: do nothing at all
    if (!Object.hasOwn(HANDLERS, event)) throw new Error(`unknown hook event ${JSON.stringify(event)}`);
    const out = HANDLERS[event](readPayload());
    if (out) emit(out);
  } catch (e) {
    logError(event, e);
  }
}
