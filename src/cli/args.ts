// Minimal argv parsing: `<verb> [positionals…] [--flag value | --switch]`.
import { FactoryError } from '../core/errors.ts';

export interface Args {
  verb: string;
  positionals: string[];
  flags: Record<string, string | true>;
}

export function parseArgs(argv: readonly string[]): Args {
  const [verb = '', ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--') { positionals.push(...rest.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[a.slice(2)] = next; i++; } else flags[a.slice(2)] = true;
    } else positionals.push(a);
  }
  return { verb, positionals, flags };
}

export function flagString(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  if (v === true) throw new FactoryError('BAD_ARGS', `--${name} needs a value`);
  return v;
}
