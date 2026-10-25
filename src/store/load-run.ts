// loadRun (AD-1, AD-28): the CLI, the dashboard server and replay all read a run through this
// (replay through loadRunFiles, on a recorded run's tree).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyEvent } from '../core/events.ts';
import { isFactKind, validateEvent } from '../core/events.ts';
import { fold, type RunState } from '../core/reducer.ts';
import { dedupeById, readLines } from './jsonl.ts';
import { commandsFile, factsDir, redactFile } from './paths.ts';

export interface LoadedRun {
  state: RunState;
  commands: AnyEvent[];
  facts: AnyEvent[];
  skipped: { file: string; offset: number; error: string }[];
}

// Reads one JSONL file and keeps only valid events of the expected family. Lines that don't parse,
// fail validateEvent, or sit in the wrong file are reported in `skipped`, never folded.
function readEvents(file: string, facts: boolean, skipped: LoadedRun['skipped']): AnyEvent[] {
  const r = readLines<unknown>(file);
  skipped.push(...r.skipped.map((x) => ({ file, ...x })));
  const out: AnyEvent[] = [];
  r.items.forEach((item, i) => {
    const v = validateEvent(item);
    const offset = r.offsets[i];
    if (!v.ok) skipped.push({ file, offset, error: v.errors.join('; ') });
    else if (isFactKind(v.event.kind) !== facts) skipped.push({ file, offset, error: `${v.event.kind} is not a ${facts ? 'fact' : 'command'}` });
    else out.push(v.event);
  });
  return out;
}

export function loadRun(repoHash: string, runId: string): LoadedRun {
  return loadRunFiles(commandsFile(repoHash, runId), factsDir(repoHash, runId));
}

// The same read for any run tree laid out like a run dir: a live run, or a recorded one (4-1).
export function loadRunFiles(commandsPath: string, factsDirPath: string): LoadedRun {
  const skipped: LoadedRun['skipped'] = [];
  const commands = dedupeById(readEvents(commandsPath, false, skipped)); // file order

  const fdir = factsDirPath;
  const facts: AnyEvent[] = [];
  if (existsSync(fdir)) {
    for (const name of readdirSync(fdir).filter((n) => n.endsWith('.jsonl')).sort()) {
      facts.push(...readEvents(join(fdir, name), true, skipped));
    }
  }
  const orderedFacts = dedupeById(facts).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { state: fold(commands), commands, facts: orderedFacts, skipped };
}

// Commands only, no facts: the Stop and guard hooks' hot path (AD-12, AD-31).
export function loadCommands(repoHash: string, runId: string): RunState {
  return fold(dedupeById(readEvents(commandsFile(repoHash, runId), false, [])));
}

// The run's extra redaction values (AD-14): a JSON array of strings, or {values: [...]}. Missing or
// unreadable means none.
export function readRedactValues(repoHash: string, runId: string): string[] {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(redactFile(repoHash, runId), 'utf8')); } catch { return []; }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? (raw as { values?: unknown }).values : undefined;
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
}
