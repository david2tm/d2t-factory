// Merges the decided AD-35 setup entries (plus sandbox on) into ~/.claude/settings.json.
// Backs the original up to spikes/.work/settings.before.json (first run only, so the
// backup always holds the pre-spike file). Idempotent: running twice yields the same file.
// Usage: node spikes/lib/apply-settings.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WORK } from './target-repo.ts';

const SETTINGS = join(homedir(), '.claude', 'settings.json');
const BACKUP = join(WORK, 'settings.before.json');

export const DECIDED = {
  permissions: {
    additionalDirectories: [join(homedir(), '.factory')],
    allow: ['EnterWorktree'],
  },
  sandbox: {
    enabled: true,
    filesystem: { allowWrite: ['~/.factory'] },
  },
};

type J = null | boolean | number | string | J[] | { [k: string]: J };

// Adds what is missing; never drops, replaces or reorders an existing key or array item.
export function mergeInto(target: { [k: string]: J }, add: { [k: string]: J }): { [k: string]: J } {
  for (const [k, v] of Object.entries(add)) {
    const cur = target[k];
    if (cur === undefined) { target[k] = structuredClone(v); continue; }
    if (Array.isArray(cur) && Array.isArray(v)) {
      for (const item of v) if (!cur.some((c) => JSON.stringify(c) === JSON.stringify(item))) cur.push(item);
      continue;
    }
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && v && typeof v === 'object' && !Array.isArray(v)) {
      mergeInto(cur as { [k: string]: J }, v as { [k: string]: J });
      continue;
    }
    // Existing scalar of a different value: keep the user's value, but report it.
    if (JSON.stringify(cur) !== JSON.stringify(v)) console.error(`apply-settings: kept existing ${k}=${JSON.stringify(cur)} (decided ${JSON.stringify(v)})`);
  }
  return target;
}

function main(): void {
  mkdirSync(WORK, { recursive: true });
  const raw = readFileSync(SETTINGS, 'utf8');
  if (!existsSync(BACKUP)) writeFileSync(BACKUP, raw);
  const merged = mergeInto(JSON.parse(raw), DECIDED as unknown as { [k: string]: J });
  const out = JSON.stringify(merged, null, 2) + '\n';
  if (out !== raw) {
    const tmp = SETTINGS + '.spike.tmp';
    writeFileSync(tmp, out);
    renameSync(tmp, SETTINGS);
  }
  console.log(JSON.stringify({ settings: SETTINGS, backup: BACKUP, changed: out !== raw, merged }, null, 2));
}

if (import.meta.main) main();
