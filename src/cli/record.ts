// `factory record <name> [--runs id,…]` (AD-18): a redacted copy of runs and their transcripts under
// recordings/<name>/. Each run's commands, facts and artifacts are copied (never redact.json, the lock
// or the dev server files), and every session bound to a run brings its transcript and its agents'
// transcripts. Every line is redacted again on the way (AD-14); the manifest is written last.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { FactoryError } from '../core/errors.ts';
import type { Envelope } from '../core/events.ts';
import { redact, redactString } from '../core/redact.ts';
import { nowIso } from '../store/ids.ts';
import { loadRun, readRedactValues } from '../store/load-run.ts';
import { claimDir } from '../store/locks.ts';
import { pluginVersion } from '../store/plugin.ts';
import {
  artifactsDir, claudeProjectsDir, commandsFile, factsDir, recordingDir, recordingManifest, recordingRunDir, recordingTranscript, runDir,
} from '../store/paths.ts';
import { isSafeId, locateTranscript } from '../store/sessions.ts';
import { flagString, type Args } from './args.ts';
import { repoHash } from './git.ts';
import { requireRun, requireSession, runExists } from './resolve.ts';

export interface RunRef { hash: string; runId: string }

// One JSONL line: parsed and deep-redacted when it is JSON, else redacted as text.
function redactLine(line: string, values: readonly string[]): string {
  if (!line.trim()) return line;
  try { return JSON.stringify(redact(JSON.parse(line) as unknown, values)); } catch { return redactString(line, values); }
}

// Complete lines only: a torn last line (a writer mid-append) is left out.
function redactJsonl(text: string, values: readonly string[]): string {
  const end = text.lastIndexOf('\n');
  if (end < 0) return '';
  return text.slice(0, end).split('\n').map((l) => redactLine(l, values)).join('\n') + '\n';
}

function writeOut(file: string, data: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}

const IMAGE_RE = /\.(?:png|jpe?g|gif|webp)$/i;

// A file into the recording: an image (a screenshot) as it is, JSONL line by line, everything else
// redacted whole (a key block spans lines).
function copyRedacted(from: string, to: string, values: readonly string[]): void {
  const buf = readFileSync(from);
  if (IMAGE_RE.test(from)) return writeOut(to, buf);
  const text = buf.toString('utf8');
  writeOut(to, from.endsWith('.jsonl') ? redactJsonl(text, values) : redactString(text, values));
}

function copyTree(from: string, to: string, values: readonly string[]): number {
  if (!existsSync(from)) return 0;
  let n = 0;
  for (const rel of readdirSync(from, { recursive: true }) as string[]) {
    const src = join(from, rel);
    if (!lstatSync(src).isFile() || rel.endsWith('.tmp')) continue; // symlinks are never followed
    copyRedacted(src, join(to, rel), values);
    n++;
  }
  return n;
}

// Under the projects dir (realpath), or null. Agent transcript paths come from facts, so they are
// only ever read from there (AD-6's rule for transcripts).
function underProjects(path: string): string | null {
  try {
    const root = realpathSync(claudeProjectsDir());
    const real = realpathSync(path);
    return real.startsWith(root + sep) && statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

export interface Recording { recording: string; path: string; runs: { repo_hash: string; run_id: string; phase: string }[]; files: number; transcripts: string[] }

export function writeRecording(name: string, runs: readonly RunRef[]): Recording {
  if (!isSafeId(name)) throw new FactoryError('BAD_ARGS', `bad recording name ${JSON.stringify(name)}`);
  if (!runs.length) throw new FactoryError('BAD_ARGS', 'no run to record');
  for (const r of runs) if (!runExists(r.hash, r.runId)) throw new FactoryError('NOT_FOUND', `no run ${r.runId}`);
  if (!claimDir(recordingDir(name))) throw new FactoryError('CLAIM_TAKEN', `recording ${name} already exists`);
  try {
    let files = 0;
    const transcripts: string[] = [];
    const manifestRuns: Recording['runs'] = [];
    // A session may be bound to several recorded runs: everything is redacted with every run's values.
    const values = [...new Set(runs.flatMap((r) => readRedactValues(r.hash, r.runId)))];
    for (const { hash, runId } of runs) {
      const run = loadRun(hash, runId);
      // The recorded tree mirrors the run dir's layout, for exactly these three parts.
      const to = (src: string): string => join(recordingRunDir(name, hash, runId), relative(runDir(hash, runId), src));
      copyRedacted(commandsFile(hash, runId), to(commandsFile(hash, runId)), values);
      files += 1 + copyTree(factsDir(hash, runId), to(factsDir(hash, runId)), values) + copyTree(artifactsDir(hash, runId), to(artifactsDir(hash, runId)), values);
      const sessions = [...new Set(run.commands.filter((e) => e.kind === 'session_bound').map((e) => (e as Envelope<'session_bound'>).data.session))].filter(isSafeId);
      for (const session of sessions) {
        const t = locateTranscript(session);
        if (t && !transcripts.includes(session)) { copyRedacted(t, recordingTranscript(name, session), values); transcripts.push(session); }
      }
      for (const f of run.facts) {
        if (f.kind !== 'subagent_stopped' || !f.session || !sessions.includes(f.session)) continue;
        const d = (f as Envelope<'subagent_stopped'>).data;
        const real = d.agent_transcript_path && isSafeId(d.agent_id) ? underProjects(d.agent_transcript_path) : null;
        const key = `${f.session}-${d.agent_id}`;
        if (real && !transcripts.includes(key)) { copyRedacted(real, recordingTranscript(name, f.session, d.agent_id), values); transcripts.push(key); }
      }
      manifestRuns.push({ repo_hash: hash, run_id: runId, phase: run.state.phase });
    }
    writeOut(recordingManifest(name), JSON.stringify({ v: 1, name, recorded_at: nowIso(), plugin_version: pluginVersion(), runs: manifestRuns.map(({ repo_hash, run_id }) => ({ repo_hash, run_id })) }, null, 2) + '\n');
    return { recording: name, path: recordingDir(name), runs: manifestRuns, files, transcripts };
  } catch (e) {
    rmSync(recordingDir(name), { recursive: true, force: true });
    throw e;
  }
}

export function record(args: Args): Recording {
  const session = requireSession(args);
  const [name, ...extra] = args.positionals;
  if (!name || extra.length) throw new FactoryError('BAD_ARGS', 'usage: factory record <name> [--runs id,…] --session <id>');
  const ids = flagString(args, 'runs');
  const cwd = process.cwd();
  if (ids === undefined) return writeRecording(name, [requireRun(cwd, session)]);
  const hash = repoHash(cwd);
  const list = ids.split(',').map((x) => x.trim()).filter(Boolean);
  if (!list.length) throw new FactoryError('BAD_ARGS', '--runs needs at least one run id');
  return writeRecording(name, list.map((runId) => ({ hash, runId })));
}
