// Creates a throwaway git repo under spikes/.work/ for spike sessions to run in.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPIKES = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
export const WORK = join(SPIKES, '.work');

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'spike', GIT_AUTHOR_EMAIL: 'spike@example.invalid', GIT_COMMITTER_NAME: 'spike', GIT_COMMITTER_EMAIL: 'spike@example.invalid' } }).trim();
}

export function createTargetRepo(name: string, files: Record<string, string> = {}): string {
  mkdirSync(WORK, { recursive: true });
  const dir = join(WORK, `repo-${name}`);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  const all = { 'README.md': `# spike target ${name}\n`, ...files };
  for (const [p, c] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'spike: init');
  return realpathSync(dir);
}
