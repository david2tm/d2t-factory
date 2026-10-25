// ULIDs for events and steps; `<slug>-<base32×4>` run IDs (AD-9).
import { randomBytes } from 'node:crypto';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now: number = Date.now()): string {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = B32[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  for (const b of randomBytes(16)) rand += B32[b & 31];
  return time + rand;
}

export function slugify(task: string): string {
  const s = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
  return s || 'run';
}

export function runId(task: string): string {
  let suffix = '';
  for (const b of randomBytes(4)) suffix += B32[b & 31];
  return `${slugify(task)}-${suffix.toLowerCase()}`;
}

export const nowIso = (): string => new Date().toISOString();
