// A run's machine claims (AD-15, AD-20): its dev-server port from PORT_RANGE and, when its run
// contract lists a shared service, the repo's `exclusive/`. Each is an atomic mkdir holding an owner
// file that names the run. A claim whose owner run is terminal, or no longer exists, is free: it is
// broken (under the lock module's break mutex) and claimed again. A claim with no owner file yet is
// held for the grace period. Claims are released only once the run's fold is terminal.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { PORT_RANGE } from '../core/config.ts';
import { FactoryError } from '../core/errors.ts';
import { isTerminal } from '../core/reducer.ts';
import { loadRun } from '../store/load-run.ts';
import { breakStale, claimDir, pastGrace } from '../store/locks.ts';
import { commandsFile, exclusiveDir, exclusiveOwnerFile, factoryHome, portDir, portOwnerFile, runsDir } from '../store/paths.ts';
import { isSafeId } from '../store/sessions.ts';

const readOwner = (file: string): string | null => {
  try { return readFileSync(file, 'utf8').trim() || null; } catch { return null; }
};

// The run is terminal or gone. A port claim names no repo, so with `hash` null the run is looked
// for under every repo in the factory home.
function runFree(hash: string | null, runId: string): boolean {
  if (!isSafeId(runId)) return true;
  let hashes = hash ? [hash] : [];
  if (!hash) { try { hashes = readdirSync(factoryHome()).filter(isSafeId); } catch { /* no home */ } }
  const h = hashes.find((x) => existsSync(commandsFile(x, runId)));
  return !h || isTerminal(loadRun(h, runId).state);
}

const claimFree = (dir: string, owner: string | null, hash: string | null): boolean =>
  !existsSync(dir) || (owner === null ? pastGrace(dir) : runFree(hash, owner));

// Breaks the claim if it is still free under the break mutex, and deletes what was broken.
function breakFree(dir: string, ownerFile: string, hash: string | null): void {
  const aside = breakStale(dir, () => existsSync(dir) && claimFree(dir, readOwner(ownerFile), hash));
  if (aside) rmSync(aside, { recursive: true, force: true });
}

// Claims `dir` for the run (reusing its own claim, breaking a free one). Null when the run holds
// it now; otherwise the holder's run id ('another run' while its owner file is still unwritten).
function claim(dir: string, ownerFile: string, runId: string, hash: string | null): string | null {
  for (let i = 0; i < 4; i++) {
    if (claimDir(dir)) {
      writeFileSync(ownerFile, runId + '\n');
      return null;
    }
    const owner = readOwner(ownerFile);
    if (owner === runId) return null;
    if (!claimFree(dir, owner, hash)) return owner ?? 'another run';
    breakFree(dir, ownerFile, hash);
  }
  return readOwner(ownerFile) ?? 'another run';
}

// --- the port (AD-20) ------------------------------------------------------------------------

// A port this run already holds is reused; else the first unclaimed one; else one whose owner run
// is terminal or gone. None free → LOCKED.
export function claimPort(runId: string): number {
  for (let n = PORT_RANGE.min; n <= PORT_RANGE.max; n++) if (readOwner(portOwnerFile(n)) === runId) return n;
  for (let n = PORT_RANGE.min; n <= PORT_RANGE.max; n++) {
    if (!claimDir(portDir(n))) continue;
    writeFileSync(portOwnerFile(n), runId + '\n');
    return n;
  }
  for (let n = PORT_RANGE.min; n <= PORT_RANGE.max; n++) if (claim(portDir(n), portOwnerFile(n), runId, null) === null) return n;
  throw new FactoryError('LOCKED', `every port in ${PORT_RANGE.min}-${PORT_RANGE.max} is claimed`);
}

// Only if this run holds it. The dev server is killed first (AD-20).
export function releasePort(runId: string, port: number | undefined): void {
  if (port !== undefined && readOwner(portOwnerFile(port)) === runId) rmSync(portDir(port), { recursive: true, force: true });
}

// --- one run per repo (AD-15) ----------------------------------------------------------------

export const refusedExclusive = (holder: string): string =>
  `Run refused — ${holder} is live in this repo and its run contract lists a shared database. One run per repo.`;

// At SCAFFOLD, for a run contract that lists a shared service.
export function claimExclusive(hash: string, runId: string): { ok: true } | { ok: false; holder: string } {
  const holder = claim(exclusiveDir(hash), exclusiveOwnerFile(hash), runId, hash);
  return holder === null ? { ok: true } : { ok: false, holder };
}

// For `factory start`: the live run holding the repo's exclusive claim, or null. A free claim is
// broken here, so it never refuses a start.
export function exclusiveHolder(hash: string): string | null {
  const dir = exclusiveDir(hash);
  for (let i = 0; i < 4; i++) {
    const owner = readOwner(exclusiveOwnerFile(hash));
    if (!existsSync(dir)) return null;
    if (!claimFree(dir, owner, hash)) return owner ?? 'another run';
    breakFree(dir, exclusiveOwnerFile(hash), hash);
  }
  return existsSync(dir) ? readOwner(exclusiveOwnerFile(hash)) ?? 'another run' : null;
}

// Only if this run holds it.
function releaseExclusive(hash: string, runId: string): void {
  if (readOwner(exclusiveOwnerFile(hash)) === runId) rmSync(exclusiveDir(hash), { recursive: true, force: true });
}

// Another non-terminal run in the repo already past SCAFFOLD (SPEC_DESIGN or later), or null. Runs
// at or before SCAFFOLD don't count, so two runs reaching SCAFFOLD together never block each other.
function runPastScaffold(hash: string, runId: string): string | null {
  let names: string[] = [];
  try { names = readdirSync(runsDir(hash)).filter(isSafeId).sort(); } catch { /* no runs */ }
  for (const id of names) {
    if (id === runId || !existsSync(commandsFile(hash, id))) continue;
    const s = loadRun(hash, id).state;
    if (!isTerminal(s) && !['INTAKE', 'ORIENT', 'SCAFFOLD'].includes(s.phase)) return id;
  }
  return null;
}

// One run per repo at the end of SCAFFOLD (AD-15): the run that blocks this one, or null. Any run
// is blocked by another live run holding exclusive/. A run whose contract lists a shared service
// claims it, and gives its fresh claim back when another live run is already past SCAFFOLD.
export function scaffoldConflict(hash: string, runId: string, shared: boolean): string | null {
  if (!shared) {
    const holder = exclusiveHolder(hash);
    return holder && holder !== runId ? holder : null;
  }
  const claimed = claimExclusive(hash, runId);
  if (!claimed.ok) return claimed.holder;
  const past = runPastScaffold(hash, runId);
  if (past) releaseExclusive(hash, runId);
  return past;
}

// Every claim the run holds: its port and the exclusive claim. Called only once the fold is terminal.
export function releaseClaims(hash: string, runId: string, port: number | undefined): void {
  releasePort(runId, port);
  releaseExclusive(hash, runId);
}
