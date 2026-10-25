// A recording, read for replay (AD-18, 4-1): its manifest and each recorded run, loaded through the
// same loadRunFiles as a live run. Reads recordings/<name>/ only, never runs/, artifacts/ or
// transcripts/, and never writes.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { loadRunFiles, type LoadedRun } from './load-run.ts';
import { isUnder, recordingCommandsFile, recordingDir, recordingFactsDir, recordingManifest, recordingRunDir } from './paths.ts';
import { isSafeId } from './sessions.ts';

export interface RecordingManifest {
  v: 1;
  name: string;
  recorded_at: string;
  plugin_version: string | null;
  runs: { repo_hash: string; run_id: string }[];
}

export interface LoadedRecording {
  manifest: RecordingManifest;
  runs: { repo_hash: string; run_id: string; loaded: LoadedRun }[];
}

export type RecordingResult = LoadedRecording | { missing: string };

const isObject = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

// The manifest's shape, or why it is not one.
function parseManifest(raw: unknown): RecordingManifest | string {
  if (!isObject(raw)) return 'the manifest is not a JSON object';
  if (raw.v !== 1) return `manifest v ${JSON.stringify(raw.v ?? null)} is not 1`;
  if (typeof raw.name !== 'string' || !raw.name) return 'the manifest has no name';
  if (typeof raw.recorded_at !== 'string' || !Number.isFinite(Date.parse(raw.recorded_at))) return 'the manifest has no valid recorded_at';
  if (!Array.isArray(raw.runs) || raw.runs.length === 0) return 'the manifest lists no runs';
  const runs: RecordingManifest['runs'] = [];
  for (const r of raw.runs) {
    if (!isObject(r) || !isSafeId(r.repo_hash) || !isSafeId(r.run_id)) return `the manifest lists a bad run ${JSON.stringify(r)}`;
    if (runs.some((x) => x.repo_hash === r.repo_hash && x.run_id === r.run_id)) return `the manifest lists run ${r.run_id} twice`;
    runs.push({ repo_hash: r.repo_hash, run_id: r.run_id });
  }
  const plugin_version = typeof raw.plugin_version === 'string' ? raw.plugin_version : null;
  return { v: 1, name: raw.name, recorded_at: raw.recorded_at, plugin_version, runs };
}

export function loadRecording(name: string): RecordingResult {
  if (!isSafeId(name)) return { missing: `bad recording name ${JSON.stringify(name)}` };
  let text: string;
  try {
    text = readFileSync(recordingManifest(name), 'utf8');
  } catch (e) {
    return { missing: (e as NodeJS.ErrnoException).code === 'ENOENT' ? `no recording named ${name}` : `recording ${name}: the manifest is unreadable` };
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { missing: `recording ${name}: the manifest is not JSON` }; }
  const manifest = parseManifest(raw);
  if (typeof manifest === 'string') return { missing: `recording ${name}: ${manifest}` };

  // Each run dir must be a real directory inside the recording: a symlink out of it (into the live
  // runs/, say) is refused.
  let root: string;
  try { root = realpathSync(recordingDir(name)); } catch { return { missing: `no recording named ${name}` }; }
  const runs: LoadedRecording['runs'] = [];
  let events = 0;
  for (const { repo_hash, run_id } of manifest.runs) {
    const dir = recordingRunDir(name, repo_hash, run_id);
    let real: string;
    try {
      real = realpathSync(dir);
      if (!statSync(real).isDirectory()) throw new Error('not a directory');
    } catch {
      return { missing: `recording ${name}: run ${run_id} is not in the recording` };
    }
    if (!isUnder(real, root)) return { missing: `recording ${name}: run ${run_id} points outside the recording` };
    const loaded = loadRunFiles(recordingCommandsFile(name, repo_hash, run_id), recordingFactsDir(name, repo_hash, run_id));
    events += loaded.commands.length + loaded.facts.length;
    runs.push({ repo_hash, run_id, loaded });
  }
  if (events === 0) return { missing: `recording ${name}: no valid event` };
  return { manifest, runs };
}
