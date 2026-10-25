// factory CLI. JSON on stdout; failures exit non-zero with {error:{code,message}}.
import { FactoryError } from '../core/errors.ts';
import { parseArgs, type Args } from './args.ts';
import { check } from './check.ts';
import { claim } from './claim.ts';
import { dashboard } from './dashboard.ts';
import { decide } from './decide.ts';
import { devserver } from './devserver.ts';
import { done } from './done.ts';
import { next } from './next.ts';
import { record } from './record.ts';
import { resume } from './resume.ts';
import { setup } from './setup.ts';
import { start } from './start.ts';
import { status } from './status.ts';

type Verb = (args: Args) => unknown | Promise<unknown>;

// Every verb except setup requires --session (AD-25); each checks it via requireSession.
const VERBS: Record<string, Verb> = {
  setup, start, resume, status, next, claim, done, decide, check, devserver, record, dashboard,
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
    const err = e instanceof FactoryError ? { code: e.code, message: e.message } : { code: 'BAD_ARGS', message: String((e as Error)?.stack ?? e) };
    process.stdout.write(JSON.stringify({ error: err }) + '\n');
    return 1;
  }
}
