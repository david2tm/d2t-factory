// The only JSONL reader and writer (AD-28).
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { MAX_LINE_BYTES } from '../core/config.ts';
import { FactoryError } from '../core/errors.ts';

const TRUNC = '…[truncated]';

// Longest string leaves first, halved until the line fits.
function longestString(v: unknown, path: (string | number)[] = []): { path: (string | number)[]; len: number } | null {
  if (typeof v === 'string') return { path, len: v.length };
  let best: { path: (string | number)[]; len: number } | null = null;
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const c = longestString(x, [...path, k]);
      if (c && (!best || c.len > best.len)) best = c;
    }
  }
  return best;
}

export function serialize<T extends { data?: unknown }>(obj: T): string {
  let line = JSON.stringify(obj);
  if (Buffer.byteLength(line) + 1 <= MAX_LINE_BYTES) return line;
  const copy = structuredClone(obj) as { data?: unknown };
  for (let i = 0; i < 64 && Buffer.byteLength(line) + 1 > MAX_LINE_BYTES; i++) {
    const hit = longestString(copy.data);
    if (!hit || hit.len <= TRUNC.length * 2) break;
    let parent: any = copy.data;
    for (const k of hit.path.slice(0, -1)) parent = parent[k];
    const key = hit.path[hit.path.length - 1];
    parent[key] = (parent[key] as string).slice(0, Math.floor(hit.len / 2)) + TRUNC;
    line = JSON.stringify(copy);
  }
  if (Buffer.byteLength(line) + 1 > MAX_LINE_BYTES) throw new FactoryError('BAD_ARGS', `event exceeds ${MAX_LINE_BYTES} bytes after truncation`);
  return line;
}

// One write on an O_APPEND descriptor, looping on short writes.
export function appendLine<T extends { data?: unknown }>(file: string, obj: T): void {
  const buf = Buffer.from(serialize(obj) + '\n');
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, 'a');
  try {
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
  } finally {
    closeSync(fd);
  }
}

export interface ReadResult<T> {
  items: T[];
  offsets: number[]; // byte offset of each item's line, parallel to `items`
  offset: number; // byte offset after the last complete line
  skipped: { offset: number; error: string }[];
}

// Reads complete lines from `offset`. A trailing partial line is left for the next read; a complete
// line that does not parse is skipped and reported.
export function readLines<T = unknown>(file: string, offset = 0): ReadResult<T> {
  if (!existsSync(file)) return { items: [], offsets: [], offset, skipped: [] };
  const fd = openSync(file, 'r');
  let buf: Buffer;
  try {
    const size = fstatSync(fd).size;
    buf = Buffer.alloc(Math.max(0, size - offset));
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, offset + got);
      if (n === 0) break;
      got += n;
    }
    buf = buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
  const end = buf.lastIndexOf(0x0a);
  const items: T[] = [];
  const offsets: number[] = [];
  const skipped: { offset: number; error: string }[] = [];
  if (end < 0) return { items, offsets, offset, skipped };
  let start = 0;
  while (start <= end) {
    const nl = buf.indexOf(0x0a, start);
    const raw = buf.subarray(start, nl).toString('utf8');
    if (raw.trim()) {
      try { items.push(JSON.parse(raw) as T); offsets.push(offset + start); } catch (e) { skipped.push({ offset: offset + start, error: String((e as Error).message) }); }
    }
    start = nl + 1;
  }
  return { items, offsets, offset: offset + end + 1, skipped };
}

export function dedupeById<T extends { id?: unknown }>(items: readonly T[]): T[] {
  const seen = new Set<unknown>();
  return items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}
