// Entry point for `bin/factory hook <Event>` (AD-13). Plain JavaScript so a Node too old to strip
// types is logged, not crashed on. A hook always exits 0 and does nothing without the factory home.
// FLOOR repeats NODE_FLOOR in src/core/config.ts, and the home default repeats src/store/paths.ts,
// because both are needed before any .ts file can load; test/hooks.test.ts checks they match.
import { appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FLOOR = '22.18.0';
const home = process.env.FACTORY_HOME || join(homedir(), '.factory');
const event = process.argv[2] ?? '';

const cmp = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

const log = (error) => {
  try { appendFileSync(join(home, 'hook-errors.log'), JSON.stringify({ v: 1, ts: new Date().toISOString(), event, pid: process.pid, error }) + '\n'); } catch { /* nowhere to report */ }
};

if (existsSync(home)) {
  if (cmp(process.versions.node, FLOOR) < 0) {
    log(`Node ${process.versions.node} (${process.execPath}) is below the floor ${FLOOR}; hooks are off until factory setup records a newer Node`);
  } else {
    try {
      const { main } = await import('./main.ts');
      await main(process.argv.slice(2));
    } catch (e) {
      log(String(e?.stack ?? e));
    }
  }
}
process.exitCode = 0;
