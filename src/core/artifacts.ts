// Machine-read artifact schemas (AD-27), the spec and plan lints. Pure: no I/O.
import { SLICE_TIMEBOX_DEFAULT_MS, SPEC_MAX_LINES } from './config.ts';
import type { DesignQuestion, Finding, Intake, SlicePlanEntry } from './events.ts';
import { parseFindings, parseOutput, parseQuestion } from './output.ts';
import { isAppReviewer, SLICE_TAGS } from './roster.ts';

type Valid<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface Context { origin: 'brownfield' | 'greenfield'; ui_surface: boolean; ui_reference?: string }
export interface Service { name: string; shared: boolean }
export interface RunContract {
  install: string; add: string; start: string; url: string; port: number; test: string; health: string;
  e2e?: string; copy_gitignored: string[]; services: Service[];
}
export interface AcceptanceCriterion { id: string; check: { kind: string; command?: string; page?: string } & Record<string, unknown> }
export interface Spec { acceptance: AcceptanceCriterion[]; assumptions: string[] }
export type DesignMode = 'inherit' | 'invent';
export interface Design {
  mode: DesignMode; colors: Record<string, string>; typography?: Record<string, unknown>; spacing?: Record<string, unknown>; rounded?: Record<string, unknown>;
  assumptions: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

function result<T>(errors: string[], value: T): Valid<T> {
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export function validateContext(f: Record<string, unknown>): Valid<Context> {
  const errors: string[] = [];
  if (f.origin !== 'brownfield' && f.origin !== 'greenfield') errors.push('origin must be brownfield or greenfield');
  if (typeof f.ui_surface !== 'boolean') errors.push('ui_surface must be true or false');
  if (f.ui_reference !== undefined && f.ui_reference !== null && !isStr(f.ui_reference)) errors.push('ui_reference must be a string');
  const value: Context = { origin: f.origin as Context['origin'], ui_surface: f.ui_surface as boolean };
  if (isStr(f.ui_reference)) value.ui_reference = f.ui_reference;
  return result(errors, value);
}

const CONTRACT_STRINGS = ['install', 'add', 'start', 'url', 'test', 'health'] as const;

export function validateRunContract(f: Record<string, unknown>): Valid<RunContract> {
  const errors: string[] = [];
  for (const k of CONTRACT_STRINGS) if (!isStr(f[k]) || !(f[k] as string).trim()) errors.push(`${k} must be a non-empty string`);
  if (!Number.isInteger(f.port) || (f.port as number) < 1 || (f.port as number) > 65535) errors.push('port must be an integer port');
  if (f.e2e !== undefined && f.e2e !== null && !isStr(f.e2e)) errors.push('e2e must be a string');
  if (!isStrList(f.copy_gitignored)) errors.push('copy_gitignored must be a JSON array of paths');
  if (!Array.isArray(f.services) || !f.services.every((s) => isObj(s) && isStr(s.name) && typeof s.shared === 'boolean')) {
    errors.push('services must be a JSON array of {"name": string, "shared": boolean}');
  }
  return result(errors, f as unknown as RunContract);
}

// The reviewers an intake may add or remove run-wide. reviewer-code always runs.
export const OVERRIDE_ROLES = ['reviewer-security', 'reviewer-ux', 'reviewer-a11y', 'reviewer-ui'] as const;
const posInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const ISO_ZONED_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

// The intake the conductor writes after the INTAKE conversation (AD-27). A missing
// slice_timebox_min becomes the default; `started` is normalized to ISO-8601 UTC.
export function validateIntake(f: Record<string, unknown>): Valid<Intake> {
  const errors: string[] = [];
  if (!posInt(f.limit_min)) errors.push('limit_min must be a whole number of minutes above 0');
  const tb = f.slice_timebox_min ?? undefined;
  if (tb !== undefined && !posInt(tb)) errors.push('slice_timebox_min must be a whole number of minutes above 0, or left out');
  if (typeof f.ui_free !== 'boolean') errors.push('ui_free must be true or false');
  const ro = f.reviewer_overrides;
  const lists: Record<'add' | 'remove', string[]> = { add: [], remove: [] };
  if (!isObj(ro)) errors.push('reviewer_overrides must be a JSON object {"add": [...], "remove": [...]}');
  else {
    for (const k of ['add', 'remove'] as const) {
      const v = ro[k] ?? [];
      if (!isStrList(v)) { errors.push(`reviewer_overrides.${k} must be a JSON array of reviewer roles`); continue; }
      for (const r of v) {
        if (k === 'remove' && r === 'reviewer-code') errors.push('reviewer-code always runs and cannot be removed');
        else if (!(OVERRIDE_ROLES as readonly string[]).includes(r)) errors.push(`reviewer_overrides.${k}: ${r} is not one of ${OVERRIDE_ROLES.join(', ')}`);
      }
      lists[k] = [...new Set(v)];
    }
    for (const r of lists.add) if (lists.remove.includes(r)) errors.push(`reviewer_overrides: ${r} is both added and removed`);
  }
  // With its zone (Z or ±hh:mm): a zoneless time would be read as the CLI's local time.
  const st = f.started ?? undefined;
  const at = isStr(st) && ISO_ZONED_RE.test(st) ? Date.parse(st) : NaN;
  if (st !== undefined && !Number.isFinite(at)) errors.push('started must be an ISO-8601 time with its zone, like "2026-10-24T14:05:00.000Z", or left out');
  const value: Intake = {
    limit_min: f.limit_min as number, slice_timebox_min: (tb as number | undefined) ?? SLICE_TIMEBOX_DEFAULT_MS / 60_000, ui_free: f.ui_free as boolean,
    reviewer_overrides: lists, ...(Number.isFinite(at) ? { started: new Date(at).toISOString() } : {}),
  };
  return result(errors, value);
}

// Shape only. What the spec must say to pass gate 1 is specLint's job.
export function validateSpec(f: Record<string, unknown>): Valid<Spec> {
  const errors: string[] = [];
  if (!Array.isArray(f.acceptance) || !f.acceptance.every((a) => isObj(a) && isStr(a.id) && isObj(a.check) && isStr(a.check.kind))) {
    errors.push('acceptance must be a JSON array of {"id": "AC-<n>", "check": {"kind": "command"|"page", …}}');
  }
  if (!isStrList(f.assumptions)) errors.push('assumptions must be a JSON array of strings');
  return result(errors, f as unknown as Spec);
}

// The builder's report: a one-line summary of what changed. The CLI commits the worktree (AD-30).
export function validateBuilder(f: Record<string, unknown>): Valid<{ summary: string }> {
  return result(isStr(f.summary) && f.summary.trim() ? [] : ['summary must be a non-empty one-line string'], f as { summary: string });
}

// The designer's design.md (3-2): DESIGN.md-style token front matter (nested maps as single-line
// JSON), and a body with the three sections reviewer-ui and the builder read.
export const DESIGN_SECTIONS = ['Components to use', 'States', 'Accessibility floor'] as const;

export function validateDesign(f: Record<string, unknown>, body = ''): Valid<Design> {
  const errors: string[] = [];
  if (f.mode !== 'inherit' && f.mode !== 'invent') errors.push('mode must be inherit or invent');
  const colors = f.colors;
  if (!isObj(colors) || !Object.keys(colors).length || !Object.values(colors).every(isStr)) errors.push('colors must be a non-empty JSON object of strings, like {"primary": "#1f6feb"}');
  for (const k of ['typography', 'spacing', 'rounded'] as const) {
    if (f[k] !== undefined && f[k] !== null && !isObj(f[k])) errors.push(`${k} must be a JSON object, or left out`);
  }
  if (f.assumptions !== undefined && f.assumptions !== null && !isStrList(f.assumptions)) errors.push('assumptions must be a JSON array of strings, or left out');
  const headings = body.split('\n').map((l) => /^##\s+(.*?)\s*#*\s*$/.exec(l.trim())?.[1].toLowerCase()).filter(Boolean);
  for (const h of DESIGN_SECTIONS) if (!headings.includes(h.toLowerCase())) errors.push(`the body has no \`## ${h}\` section`);
  // Gate 1 counts assumptions[]: every [ASSUMPTION] mark in the body must be listed there.
  const marks = body.match(/\[ASSUMPTION\]/g)?.length ?? 0;
  const listed = isStrList(f.assumptions) ? f.assumptions.length : 0;
  if (marks !== listed) errors.push(`the body has ${marks} [ASSUMPTION] marks but assumptions lists ${listed}`);
  const value = { ...f, assumptions: isStrList(f.assumptions) ? f.assumptions : [] } as unknown as Design;
  return result(errors, value);
}

// The slicer's plan (3-3): `slices` as one single-line JSON list of
// {"id", "title", "acs": [...], "tags": [...], "depends_on": [...]}. Shape and tags only: ids, AC
// coverage and dependency order are plan.lint's job, so a bad plan reaches gate 2 with its errors.
export function validateSlicePlan(f: Record<string, unknown>): Valid<SlicePlanEntry[]> {
  const errors: string[] = [];
  const list = f.slices;
  if (!Array.isArray(list)) return result(['slices must be a single-line JSON list of {"id": "S<n>", "title": …, "acs": [...], "tags": [...], "depends_on": [...]}'], []);
  list.forEach((x, i) => {
    const at = `slices[${i}]${isObj(x) && isStr(x.id) ? ` (${x.id})` : ''}`;
    if (!isObj(x)) { errors.push(`${at} must be a JSON object`); return; }
    if (!isStr(x.id)) errors.push(`${at}: id must be a string like "S1"`);
    if (!isStr(x.title)) errors.push(`${at}: title must be a string`);
    for (const k of ['acs', 'tags', 'depends_on'] as const) if (!isStrList(x[k])) errors.push(`${at}: ${k} must be a JSON array of strings`);
    for (const t of isStrList(x.tags) ? x.tags : []) {
      if (!(SLICE_TAGS as readonly string[]).includes(t)) errors.push(`${at}: tag ${JSON.stringify(t)} is not one of ${SLICE_TAGS.join(', ')}`);
    }
  });
  return result(errors, errors.length ? [] : slicePlanEntries(f));
}

// The plan entries of a slicer front matter (the slicer's depends_on becomes deps), or [] when it
// has none. Fields keep the order gate_2_passed embeds them in; plan.lint adds each roster.
export function slicePlanEntries(f: Record<string, unknown> | undefined): SlicePlanEntry[] {
  const list = f?.slices;
  if (!Array.isArray(list)) return [];
  const strs = (v: unknown): string[] => (isStrList(v) ? [...v] : []);
  return list.filter(isObj).map((x) => ({ id: String(x.id), title: isStr(x.title) ? x.title : undefined, acs: strs(x.acs), tags: strs(x.tags), deps: strs(x.depends_on) }));
}

// --- agent output = protocol (AD-11) + the role's schema (AD-27) ------------------------------

const SCHEMA: Record<string, (f: Record<string, unknown>, body: string) => Valid<unknown>> = {
  recon: validateContext,
  framer: validateContext, // FRAME (5-2): the same context schema as RECON
  scaffolder: validateRunContract,
  'spec-writer': validateSpec,
  builder: validateBuilder,
  designer: validateDesign,
  slicer: validateSlicePlan,
  intake: validateIntake, // the conductor's own out.md at INTAKE, not an agent's
};

export type AgentOutput =
  | { ok: false; error: string }
  | {
    ok: true; status: string; escalation?: { label: string; line: string }; front: Record<string, unknown>; body: string;
    failure?: string; // parsed and valid, but a SCAFFOLD failure (the port is not the claimed one)
    findings?: Finding[]; // reviewers: the parsed ```finding blocks
    question?: DesignQuestion; // the designer: its one ```question block (invent mode only)
  };

// What checkOutput needs beyond the text: the claimed port (scaffolder), for the designer the mode
// the run's context implies and whether the run's one design question was already answered, and for
// the orientation roles the run's origin (5-2).
export interface OutputOpts { port?: number; mode?: DesignMode; no_question?: boolean; origin?: Context['origin'] }

// AD-27 (5-2): RECON maps a brownfield repo, FRAME frames a greenfield one.
export const originOf = (role: string | undefined): Context['origin'] | undefined => (role === 'framer' ? 'greenfield' : role === 'recon' ? 'brownfield' : undefined);

// A parse or schema error means the agent must redo the step (MISSING_EVIDENCE + reissue).
export function checkOutput(role: string | undefined, text: string, o: OutputOpts = {}): AgentOutput {
  const p = parseOutput(text, { role });
  if (!p.ok) return { ok: false, error: p.error };
  const v = p.value;
  const reviewer = Boolean(role?.startsWith('reviewer-'));
  if (reviewer !== (v.form === 'VERDICT')) return { ok: false, error: `line 1 must use ${reviewer ? 'VERDICT' : 'STATUS'}` };
  const out = { ok: true as const, status: v.value, escalation: v.escalation, front: v.front, body: v.body };
  // Intake has no one to escalate to: the human is in the conversation (or abandons the run).
  if (role === 'intake' && v.value !== 'DONE') return { ok: false, error: 'line 1 must be `STATUS: DONE`: settle open questions with the human, then write the intake' };
  // FRAME asks the human nothing (5-2): every open decision is the framer's to make.
  if (role === 'framer' && v.value !== 'DONE') return { ok: false, error: 'line 1 must be `STATUS: DONE`: FRAME asks the human nothing; decide and write the frame' };
  if (v.value === 'ESCALATE') return out;
  if (reviewer) {
    // FINDINGS needs at least one finding and APPROVE none: a verdict and its findings never disagree.
    const f = parseFindings(v.body);
    if (!f.ok) return { ok: false, error: f.error };
    if (v.value === 'FINDINGS' && !f.findings.length) return { ok: false, error: 'VERDICT: FINDINGS needs at least one ```finding block' };
    if (v.value === 'APPROVE' && f.findings.length) return { ok: false, error: `VERDICT: APPROVE must have no finding, got ${f.findings.length}` };
    // Running-app reviewers judge what they saw: every finding cites the observed page state.
    const blind = isAppReviewer(role) ? f.findings.findIndex((x) => !x.observed) : -1;
    if (blind >= 0) return { ok: false, error: `finding ${blind + 1}: observed is missing; a ${role} finding ends with \`observed: <url> <state> [<screenshot>]\`` };
    return { ...out, findings: f.findings };
  }
  const schema = role ? SCHEMA[role] : undefined;
  if (schema) {
    if (!v.has_front) return { ok: false, error: 'front matter missing: line 2 must be --- and the block must close with ---' };
    const r = schema(v.front, v.body);
    if (!r.ok) return { ok: false, error: `front matter: ${r.errors.join('; ')}` };
  }
  // The origin is the role's (5-2): a framer frames greenfield, recon maps brownfield; and the role
  // must be the one the run's origin (o.origin) orients with.
  const want = originOf(role);
  if (want && v.front.origin !== want) return { ok: false, error: `front matter: origin must be ${want} in a ${role} output` };
  if (want && o.origin && o.origin !== want) return { ok: false, error: `a ${role} output on a ${o.origin} run: it orients with ${o.origin === 'greenfield' ? 'framer' : 'recon'}` };
  if (role === 'designer') {
    if (o.mode && v.front.mode !== o.mode) return { ok: false, error: `front matter: mode must be ${o.mode} for this run's context` };
    const q = parseQuestion(v.body);
    if (!q.ok) return { ok: false, error: q.error };
    if (q.question && v.front.mode === 'inherit') return { ok: false, error: 'inherit mode asks no question: remove the ```question block' };
    if (q.question && o.no_question) return { ok: false, error: 'the design question was already answered: ask no question, remove the ```question block' };
    return q.question ? { ...out, question: q.question } : out;
  }
  if (role === 'scaffolder' && o.port !== undefined && v.front.port !== o.port) {
    return { ...out, failure: `run contract port ${String(v.front.port)} is not the claimed port ${o.port}` };
  }
  return out;
}

// --- gate 1: spec.lint -----------------------------------------------------------------------

const AC_RE = /^AC-[1-9]\d*$/;
const HEADING_RE = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const ITEM_RE = /^\s*[-*]\s+(.*\S)\s*$/;

export interface SpecLint { ok: boolean; errors: string[]; acs: string[]; assumptions: number; lines: number }

// The body without leading and trailing blank lines.
function bodyLines(body: string): string[] {
  const l = body.split('\n');
  while (l.length && !l[0].trim()) l.shift();
  while (l.length && !l[l.length - 1].trim()) l.pop();
  return l;
}

function assumptionItems(lines: readonly string[]): string[] | null {
  const at = lines.findIndex((l) => HEADING_RE.exec(l)?.[1].toLowerCase() === 'assumptions');
  if (at < 0) return null;
  const items: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (HEADING_RE.test(l)) break;
    const m = ITEM_RE.exec(l);
    if (m) items.push(m[1]);
  }
  return items;
}

export function specLint(front: Record<string, unknown>, body: string, maxLines: number = SPEC_MAX_LINES): SpecLint {
  const errors: string[] = [];
  const shape = validateSpec(front);
  const lines = bodyLines(body);
  if (lines.length > maxLines) errors.push(`spec body is ${lines.length} lines; the limit is ${maxLines}`);
  if (!shape.ok) return { ok: false, errors: [...errors, ...shape.errors], acs: [], assumptions: 0, lines: lines.length };
  const { acceptance, assumptions } = shape.value;
  if (!acceptance.length) errors.push('no acceptance criteria');
  const seen = new Set<string>();
  for (const ac of acceptance) {
    if (!AC_RE.test(ac.id)) errors.push(`${ac.id}: id must be AC-<n>`);
    if (seen.has(ac.id)) errors.push(`${ac.id}: duplicate id`);
    seen.add(ac.id);
    const c = ac.check;
    const ok = (c.kind === 'command' && isStr(c.command) && c.command.trim()) || (c.kind === 'page' && isStr(c.page) && c.page.trim());
    if (!ok) errors.push(`${ac.id}: check must be {"kind":"command","command":…} or {"kind":"page","page":…}`);
  }
  const items = assumptionItems(lines);
  if (items === null) errors.push('no Assumptions section');
  else if (items.length !== assumptions.length || items.some((x, i) => x !== assumptions[i].trim())) {
    errors.push(`the Assumptions section (${items.length} items) does not match assumptions[] (${assumptions.length})`);
  }
  return { ok: !errors.length, errors, acs: acceptance.map((a) => a.id), assumptions: assumptions.length, lines: lines.length };
}

// The AC ids of a spec's front matter, or [] when it has none.
export function acIds(front: Record<string, unknown> | undefined): string[] {
  const a = front?.acceptance;
  return Array.isArray(a) ? a.filter((x) => isObj(x) && isStr(x.id)).map((x) => (x as { id: string }).id) : [];
}

// The front matter and body of a spec step's out.md, or null when it doesn't parse.
export function readSpec(text: string): { front: Record<string, unknown>; body: string } | null {
  const p = parseOutput(text);
  return p.ok ? { front: p.value.front, body: p.value.body } : null;
}

// --- gate 2: plan.lint ------------------------------------------------------------------------

const SLICE_RE = /^S[1-9]\d*$/;

export function planLint(plan: readonly SlicePlanEntry[], acs: readonly string[]): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!plan.length) errors.push('no slices');
  const seen: string[] = [];
  const covered = new Set<string>();
  for (const s of plan) {
    if (!SLICE_RE.test(s.id)) errors.push(`${s.id}: id must be S<n>`);
    if (seen.includes(s.id)) errors.push(`${s.id}: duplicate id`);
    if (!s.title?.trim()) errors.push(`${s.id}: no title`);
    if (!s.acs?.length) errors.push(`${s.id}: covers no acceptance criterion`);
    for (const a of s.acs ?? []) {
      if (!acs.includes(a)) errors.push(`${s.id}: ${a} is not in the spec`);
      covered.add(a);
    }
    for (const t of s.tags ?? []) if (!(SLICE_TAGS as readonly string[]).includes(t)) errors.push(`${s.id}: ${t} is not a slice tag (${SLICE_TAGS.join(', ')})`);
    for (const d of s.deps ?? []) if (!seen.includes(d)) errors.push(`${s.id}: depends on ${d}, which is not an earlier slice`);
    seen.push(s.id);
  }
  for (const a of acs) if (!covered.has(a)) errors.push(`${a} is in no slice`);
  return { ok: !errors.length, errors };
}

// --- git.deps: manifests and lockfiles (brownfield new dependency) ------------------------------

const DEPENDENCY_FILE_RE = new RegExp('^(?:' + [
  'package\\.json', 'package-lock\\.json', 'npm-shrinkwrap\\.json', 'yarn\\.lock', 'pnpm-lock\\.yaml', 'bun\\.lockb?', 'deno\\.jsonc?', 'deno\\.lock',
  'requirements.*\\.txt', 'Pipfile(?:\\.lock)?', 'pyproject\\.toml', 'poetry\\.lock', 'uv\\.lock', 'setup\\.py', 'setup\\.cfg',
  'go\\.mod', 'go\\.sum', 'Cargo\\.(?:toml|lock)', 'Gemfile(?:\\.lock)?', 'pom\\.xml', 'build\\.gradle(?:\\.kts)?', 'composer\\.(?:json|lock)',
  '.+\\.csproj', 'Package\\.(?:swift|resolved)', 'mix\\.(?:exs|lock)',
].join('|') + ')$');

// A path whose basename is a dependency manifest or lockfile, by an explicit list.
export const isDependencyFile = (path: string): boolean => DEPENDENCY_FILE_RE.test(path.split('/').pop() ?? '');
