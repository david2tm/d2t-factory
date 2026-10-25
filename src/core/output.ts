// Agent output protocol (AD-11): line 1, the escalation line after ESCALATE, the `---` front
// matter that follows (AD-27), and reviewers' ```finding blocks. Pure: no I/O.
import type { DesignQuestion, Finding } from './events.ts';
//
// Front matter is a YAML subset: one `key: value` per line, where the value is a plain scalar or a
// single-line JSON flow value (`[…]`, `{…}` or a "string"). Everything accepted is also valid YAML.

export const STATUSES = ['DONE', 'ESCALATE'] as const;
export const VERDICTS = ['APPROVE', 'FINDINGS', 'ESCALATE'] as const;
export const ESCALATION_LABELS = [
  'Scope change', 'Spec ambiguity', 'Irreversible action', 'New dependency', 'Non-convergence', 'Over time box',
  'Taste disagreement', 'Scaffold failed',
] as const;

export interface ParsedOutput {
  form: 'STATUS' | 'VERDICT';
  value: string; // DONE | ESCALATE | APPROVE | FINDINGS
  escalation?: { label: string; line: string };
  front: Record<string, unknown>;
  has_front: boolean;
  body: string;
}

export type OutputResult = { ok: true; value: ParsedOutput } | { ok: false; error: string };

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/;
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
// A plain YAML scalar may not start with an indicator, nor contain `: ` or ` #`.
const INDICATOR_RE = /^[&*!|>%@`,?:-](?:\s|$)|^[&*!|>%@`]/;

type Scalar = { ok: true; value: unknown } | { ok: false; error: string };

export function parseScalar(raw: string): Scalar {
  const v = raw.trim();
  if (v === '' || v === '~' || v === 'null') return { ok: true, value: null };
  if (v.startsWith('[') || v.startsWith('{') || v.startsWith('"')) {
    try { return { ok: true, value: JSON.parse(v) }; } catch (e) { return { ok: false, error: `not a single-line JSON value (${(e as Error).message})` }; }
  }
  if (v.startsWith("'")) {
    if (v.length < 2 || !v.endsWith("'")) return { ok: false, error: 'unterminated single-quoted string' };
    return { ok: true, value: v.slice(1, -1).replace(/''/g, "'") };
  }
  if (v === 'true') return { ok: true, value: true };
  if (v === 'false') return { ok: true, value: false };
  if (NUMBER_RE.test(v)) return { ok: true, value: Number(v) };
  if (INDICATOR_RE.test(v) || v.includes(': ') || v.includes(' #')) return { ok: false, error: 'plain value needs quoting; write it as a JSON string' };
  return { ok: true, value: v };
}

export function parseFrontMatter(lines: readonly string[]): { ok: true; front: Record<string, unknown> } | { ok: false; error: string } {
  const front: Record<string, unknown> = {};
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const m = KEY_RE.exec(line);
    if (!m) return { ok: false, error: `front matter line is not \`key: value\`: ${JSON.stringify(line.slice(0, 80))}` };
    const key = m[1];
    if (Object.hasOwn(front, key)) return { ok: false, error: `front matter key ${key} appears twice` };
    const v = parseScalar(m[2] ?? '');
    if (!v.ok) return { ok: false, error: `front matter ${key}: ${v.error}` };
    front[key] = v.value;
  }
  return { ok: true, front };
}

// `role` (3-4): `Scaffold failed` is a declared ask of the scaffolder alone; for any other role (and
// with no role) it is a parse error. Callers that only read structure (a spec's front matter) omit it.
export function parseOutput(text: string, o: { role?: string } = {}): OutputResult {
  const lines = text.replace(/^﻿/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  const first = /^(STATUS|VERDICT): (\S+)$/.exec(lines[0].trimEnd());
  if (!first) return { ok: false, error: 'line 1 must be `STATUS: DONE|ESCALATE` or `VERDICT: APPROVE|FINDINGS|ESCALATE`' };
  const form = first[1] as 'STATUS' | 'VERDICT';
  const value = first[2];
  const allowed: readonly string[] = form === 'STATUS' ? STATUSES : VERDICTS;
  if (!allowed.includes(value)) return { ok: false, error: `line 1: ${form} must be one of ${allowed.join('|')}, got ${value}` };
  let i = 1;
  let escalation: ParsedOutput['escalation'];
  if (value === 'ESCALATE') {
    const m = /^([A-Za-z -]+): (\S.*)$/.exec((lines[1] ?? '').trimEnd());
    if (!m || !(ESCALATION_LABELS as readonly string[]).includes(m[1])) {
      return { ok: false, error: `line 2 after ESCALATE must be \`<Label>: <one line>\` with a label in ${ESCALATION_LABELS.join(' | ')}` };
    }
    if (m[1] === 'Scaffold failed' && 'role' in o && o.role !== 'scaffolder') {
      return { ok: false, error: `line 2: Scaffold failed is the scaffolder's alone; use one of ${ESCALATION_LABELS.filter((l) => l !== 'Scaffold failed').join(' | ')}` };
    }
    escalation = { label: m[1], line: m[2].trim() };
    i = 2;
  }
  if ((lines[i] ?? '').trimEnd() !== '---') return { ok: true, value: { form, value, escalation, front: {}, has_front: false, body: lines.slice(i).join('\n') } };
  const end = lines.findIndex((l, j) => j > i && l.trimEnd() === '---');
  if (end < 0) return { ok: false, error: `front matter opened on line ${i + 1} is never closed with ---` };
  const fm = parseFrontMatter(lines.slice(i + 1, end));
  if (!fm.ok) return { ok: false, error: fm.error };
  return { ok: true, value: { form, value, escalation, front: fm.front, has_front: true, body: lines.slice(end + 1).join('\n') } };
}

// --- reviewer findings (AD-11) ----------------------------------------------------------------

// The charter's categories: nothing else is reportable (review policy).
export const FINDING_CATEGORIES = ['Bug', 'Spec miss', 'Security', 'Breakage'] as const;
const FINDING_KEYS = ['category', 'location', 'failure_scenario'] as const;
const FENCE_OPEN_RE = /^\s*```finding\s*$/;
const FENCE_CLOSE_RE = /^\s*```\s*$/;

export type FindingsResult = { ok: true; findings: Finding[] } | { ok: false; error: string };

// Every ```finding block in a body: `category:`, `location:` and `failure_scenario:`, one per line, in
// that order, then an optional `observed:` (running-app reviewers). Anything else in a block is an error.
export function parseFindings(body: string): FindingsResult {
  const lines = body.split('\n').map((l) => l.replace(/\r$/, ''));
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE_OPEN_RE.test(lines[i])) continue;
    const n = findings.length + 1;
    const end = lines.findIndex((l, j) => j > i && FENCE_CLOSE_RE.test(l));
    if (end < 0) return { ok: false, error: `finding ${n} is never closed with \`\`\`` };
    const rows = lines.slice(i + 1, end).filter((l) => l.trim());
    const f: Record<string, string> = {};
    const keys = [...FINDING_KEYS, 'observed'];
    for (const [k, row] of rows.entries()) {
      const m = /^([a-z_]+):[ \t]*(.*)$/.exec(row.trim());
      if (!m || m[1] !== keys[k]) {
        return { ok: false, error: `finding ${n}: line ${k + 1} must be \`${keys[k] ?? '```'}: …\` (category, location, failure_scenario, in that order)` };
      }
      if (!m[2].trim()) return { ok: false, error: `finding ${n}: ${m[1]} is empty` };
      f[m[1]] = m[2].trim();
    }
    const missing = FINDING_KEYS.find((k) => !f[k]);
    if (missing) return { ok: false, error: `finding ${n}: ${missing} is missing` };
    if (!(FINDING_CATEGORIES as readonly string[]).includes(f.category)) {
      return { ok: false, error: `finding ${n}: category must be one of ${FINDING_CATEGORIES.join(' | ')}, got ${f.category}` };
    }
    findings.push({ category: f.category, location: f.location, failure_scenario: f.failure_scenario, ...(f.observed ? { observed: f.observed } : {}) });
    i = end;
  }
  return { ok: true, findings };
}

// --- the designer's question (AD-11, 3-2) -----------------------------------------------------

const QUESTION_KEYS = ['question', 'a', 'b', 'default'] as const;
const QUESTION_OPEN_RE = /^\s*```question\s*$/;

export type QuestionResult = { ok: true; question?: DesignQuestion } | { ok: false; error: string };

// At most one ```question block in a body: `question:`, `a:`, `b:` and `default: a|b`, one per line,
// in that order, nothing else. No block is fine (no question).
export function parseQuestion(body: string): QuestionResult {
  const lines = body.split('\n').map((l) => l.replace(/\r$/, ''));
  const opens = lines.flatMap((l, i) => (QUESTION_OPEN_RE.test(l) ? [i] : []));
  if (!opens.length) return { ok: true };
  if (opens.length > 1) return { ok: false, error: `at most one \`\`\`question block, got ${opens.length}` };
  const i = opens[0];
  const end = lines.findIndex((l, j) => j > i && FENCE_CLOSE_RE.test(l));
  if (end < 0) return { ok: false, error: 'the question block is never closed with ```' };
  const rows = lines.slice(i + 1, end).filter((l) => l.trim());
  const q: Record<string, string> = {};
  for (const [k, row] of rows.entries()) {
    const m = /^([a-z_]+):[ \t]*(.*)$/.exec(row.trim());
    if (!m || m[1] !== QUESTION_KEYS[k]) {
      return { ok: false, error: `question: line ${k + 1} must be \`${QUESTION_KEYS[k] ?? '```'}: …\` (question, a, b, default, in that order)` };
    }
    if (!m[2].trim()) return { ok: false, error: `question: ${m[1]} is empty` };
    q[m[1]] = m[2].trim();
  }
  const missing = QUESTION_KEYS.find((k) => !q[k]);
  if (missing) return { ok: false, error: `question: ${missing} is missing` };
  if (q.default !== 'a' && q.default !== 'b') return { ok: false, error: `question: default must be a or b, got ${q.default}` };
  return { ok: true, question: { question: q.question, a: q.a, b: q.b, default: q.default } };
}
