// Single-sourced redaction (AD-14). Every writer runs it at write time; it is idempotent. Pure: no I/O.

export const REDACTED = '[REDACTED]';

// Secret patterns. Each match is replaced whole, except `Bearer`, which keeps the scheme word.
const PATTERNS: readonly [RegExp, string][] = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{20,}/g, `$1 ${REDACTED}`],
];

const MARK = /\[REDACTED\]/;

// One pass over the text between existing markers, so a marker is never rewritten.
function pass(text: string, extra: readonly string[]): string {
  return text.split(MARK).map((seg) => {
    let s = seg;
    for (const [re, to] of PATTERNS) s = s.replace(re, to);
    for (const v of extra) if (v) s = s.split(v).join(REDACTED);
    return s;
  }).join(REDACTED);
}

export function redactString(text: string, extra: readonly string[] = []): string {
  let cur = text;
  // A replacement can only remove text, so this settles in a pass or two; the loop makes the result a fixpoint.
  for (let i = 0; i < 8; i++) {
    const next = pass(cur, extra);
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}

// Deep: every string in arrays and plain objects. Keys and non-string leaves are kept.
export function redact<T>(value: T, extra: readonly string[] = []): T {
  if (typeof value === 'string') return redactString(value, extra) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, extra)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, extra);
    return out as T;
  }
  return value;
}
