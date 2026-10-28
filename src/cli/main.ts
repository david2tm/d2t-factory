// factory CLI. JSON on stdout; failures exit non-zero with {error:{code,message}}.
import { deniedWhat, FactoryError, isDenied, sandboxDenied } from '../core/errors.ts';
import { parseArgs, type Args } from './args.ts';
import { check } from './check.ts';
import { claim } from './claim.ts';
import { dashboard } from './dashboard.ts';
import { decide } from './decide.ts';
import { devserver } from './devserver.ts';
import { done } from './done.ts';
import { next } from './next.ts';
import { prune } from './prune.ts';
import { record } from './record.ts';
import { resume } from './resume.ts';
import { setup } from './setup.ts';
import { start } from './start.ts';
import { status } from './status.ts';

type Verb = (args: Args) => unknown | Promise<unknown>;

// Every verb except setup and prune (read only, for the human's own terminal) requires --session
// (AD-25); each checks it via requireSession.
const VERBS: Record<string, Verb> = {
  setup, start, resume, status, next, claim, done, decide, check, devserver, record, dashboard, prune,
};

export async function main(argv: readonly string[]): Promise<number> {
  try {
    const args = parseArgs(argv);
    const verb = Object.hasOwn(VERBS, args.verb) ? VERBS[args.verb] : undefined;
    if (!verb) throw new FactoryError('BAD_ARGS', args.verb ? `unknown verb ${args.verb}` : `usage: factory <${Object.keys(VERBS).join('|')}> …`);
    const out = await verb(args);
    process.stdout.write(JSON.stringify(out) + '\n');
    return 0;
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: errorOf(e) }) + '\n');
    return 1;
  }
}

// A thrown error as {code, message}: a FactoryError as is; an fs or net EPERM/EACCES naming a path
// or address is SANDBOX_DENIED naming it (AD-35), never BAD_ARGS; anything else (a path-less EPERM,
// like a refused process.kill, included) is BAD_ARGS with its stack.
export function errorOf(e: unknown): { code: string; message: string } {
  const named = isDenied(e) && (e.path !== undefined || (e as { address?: unknown }).address !== undefined);
  const x = e instanceof FactoryError ? e : named ? sandboxDenied(deniedWhat(e as NodeJS.ErrnoException)) : null;
  return x ? { code: x.code, message: x.message } : { code: 'BAD_ARGS', message: String((e as Error)?.stack ?? e) };
}
