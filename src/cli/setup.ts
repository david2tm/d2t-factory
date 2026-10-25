// `factory setup` (AD-35): one-time, idempotent machine setup.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { FactoryError } from '../core/errors.ts';
import { claudeSettingsFile, factoryHome, nodeLink } from '../store/paths.ts';
import type { Args } from './args.ts';

export const ALLOW_RULES = ['EnterWorktree', 'Bash(factory:*)'] as const;

type Json = Record<string, unknown>;

function obj(parent: Json, key: string, where: string): Json {
  const v = parent[key];
  if (v === undefined) return (parent[key] = {}) as Json;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new FactoryError('SETUP_FAILED', `${where} is not an object; fix it by hand`);
  return v as Json;
}

function list(parent: Json, key: string, where: string): unknown[] {
  const v = parent[key];
  if (v === undefined) return (parent[key] = []) as unknown[];
  if (!Array.isArray(v)) throw new FactoryError('SETUP_FAILED', `${where} is not an array; fix it by hand`);
  return v;
}

const expandHome = (p: unknown): unknown => (typeof p === 'string' ? p.replace(/^~(?=$|\/)/, homedir()) : p);

// Pure merge: adds the factory's entries, never removes or reorders existing ones. Returns what changed.
export function mergeSettings(settings: Json, home: string): string[] {
  const changed: string[] = [];
  const perms = obj(settings, 'permissions', 'permissions');
  const dirs = list(perms, 'additionalDirectories', 'permissions.additionalDirectories');
  if (!dirs.some((d) => expandHome(d) === home)) { dirs.push(home); changed.push(`permissions.additionalDirectories += ${home}`); }
  const allow = list(perms, 'allow', 'permissions.allow');
  for (const rule of ALLOW_RULES) if (!allow.includes(rule)) { allow.push(rule); changed.push(`permissions.allow += ${rule}`); }
  // AD-35: the sandbox write rule only when the user runs a sandbox.
  const sb = settings.sandbox as Json | undefined;
  if (sb && typeof sb === 'object' && sb.enabled === true) {
    const fsCfg = obj(sb, 'filesystem', 'sandbox.filesystem');
    const w = list(fsCfg, 'allowWrite', 'sandbox.filesystem.allowWrite');
    if (!w.some((d) => expandHome(d) === home)) { w.push(home); changed.push(`sandbox.filesystem.allowWrite += ${home}`); }
  }
  return changed;
}

// What setup cannot fix but the user must (the merge never touches these): with the sandbox on and
// local binding off, the dashboard and the run's dev server cannot listen.
export function settingsWarnings(settings: Json, file: string): string[] {
  const sb = settings.sandbox as Json | undefined;
  if (!sb || typeof sb !== 'object' || sb.enabled !== true) return [];
  const net = sb.network as Json | undefined;
  if (net && typeof net === 'object' && net.allowLocalBinding === true) return [];
  return [`the sandbox is on but sandbox.network.allowLocalBinding is not true, so the dashboard and the run's dev server cannot listen on a local port (listen EPERM): set "sandbox": {"network": {"allowLocalBinding": true}} in ${file}`];
}

// `rename` is injectable so a test can fail only the rename onto settings.json.
export function setup(_args: Args, rename = renameSync): Json {
  const home = factoryHome();
  // A sandbox can't create an allow-listed directory that doesn't exist yet (spike 03).
  try {
    mkdirSync(home, { recursive: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new FactoryError('SETUP_FAILED', `cannot create ${home} (${code}). If this runs inside a sandbox, run factory setup in your own terminal.`);
  }

  const link = nodeLink();
  let current: string | null = null;
  try { current = readlinkSync(link); } catch { /* absent */ }
  const nodeChanged = current !== process.execPath;
  if (nodeChanged) {
    rmSync(link, { force: true });
    symlinkSync(process.execPath, link);
  }

  const file = claudeSettingsFile();
  let settings: Json = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8')) as Json;
    } catch (e) {
      throw new FactoryError('SETUP_FAILED', `${file} is not valid JSON (${(e as Error).message}); not touching it`);
    }
  }
  const changed = mergeSettings(settings, home);
  if (changed.length) {
    const tmp = `${file}.factory-${process.pid}.tmp`;
    try {
      mkdirSync(dirname(file), { recursive: true });
      if (existsSync(file) && !existsSync(`${file}.before-factory`)) copyFileSync(file, `${file}.before-factory`);
      writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
      rename(tmp, file);
    } catch (e) {
      // The rename is the only step that touches the original, so on any failure it is unchanged.
      try { rmSync(tmp, { force: true }); } catch { /* nothing to clean up */ }
      const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
      throw new FactoryError('SETUP_FAILED', `cannot write ${file} (${code}). If this runs inside a sandbox, run factory setup in your own terminal.`);
    }
  }

  return {
    factory_home: home,
    node: process.execPath,
    node_changed: nodeChanged,
    settings_file: file,
    settings_changed: changed,
    warnings: settingsWarnings(settings, file),
    // AD-22 is open (spike 04): the browser driver for sandboxed reviewers isn't decided yet.
    browser: 'skipped: agent-browser install waits on the AD-22 decision',
  };
}
