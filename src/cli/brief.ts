// The only writer of brief.md (AD-10). Each brief lists its input paths explicitly; the agent
// reads only those and writes only its output_path (AD-2).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { OVERRIDE_ROLES } from '../core/artifacts.ts';
import { CUT_LEAD_MS, SLICE_TIMEBOX_DEFAULT_MS, SPEC_MAX_LINES } from '../core/config.ts';
import type { AnyEvent, Envelope, Finding, ScaffoldRepair, Stage } from '../core/events.ts';
import { ESCALATION_LABELS, FINDING_CATEGORIES } from '../core/output.ts';
import { redactString } from '../core/redact.ts';
import type { RunState } from '../core/reducer.ts';
import { appReviewerTools, isAppReviewer, isDiffReviewer, REVIEWERS, SLICE_TAGS, sliceRoster } from '../core/roster.ts';
import { activeScaffoldRepair, designMode, isVoided, latestByRole, latestDesign, latestSpec, latestStep, roundFailure, roundOf, sliceDeps, uiReference } from '../core/verify.ts';
import { readRedactValues } from '../store/load-run.ts';
import { briefFile, inCheckout, playwrightDir, runCacheDir } from '../store/paths.ts';
import { contractOf } from './devserver.ts';

export interface BriefStep { id: string; role: string; stage: Stage; attempt: number; output_path: string; slice?: string }
// 6-4: `repair`, a SCAFFOLD repair round's failures and failed check steps, with the step whose
// contract round 1 reported (`previous`).
export interface BriefRepair extends ScaffoldRepair { previous: string }
export interface BriefExtra { notes?: readonly string[]; error?: string; repair?: BriefRepair }

// The repair a scaffolder brief carries (6-4): the one being issued, else the active repair, so a
// reissue of the repair step (a parse failure, an orphan, a resume whose agent is gone) keeps it.
function repairOf(role: string, commands: readonly AnyEvent[], extra: BriefExtra): BriefRepair | undefined {
  if (role !== 'scaffolder') return undefined;
  if (extra.repair) return extra.repair;
  const active = activeScaffoldRepair(commands);
  return active ? { ...active.repair, previous: active.old } : undefined;
}

// The repair envelope (review-policy.md, SCAFFOLD repair).
const REPAIR_ENVELOPE = "Repair envelope: change only the contract's commands (env vars, flags, the package-manager command form, timeouts); point tool caches at `$FACTORY_CACHE_DIR`; never delete or edit anything outside the worktree; change no tracked file; add no dependency.";

// `Scaffold failed` is the scaffolder's declared ask alone (3-4); every other role escalates with a
// closed-list condition.
const labelsFor = (role: string): string => ESCALATION_LABELS.filter((l) => role === 'scaffolder' || l !== 'Scaffold failed').join(', ');
// FRAME's UI kit when the task names none (AD-27, 5-2): shadcn-class.
export const DEFAULT_UI_KIT = 'shadcn/ui';

const ESCALATE = (label: string, role: string): string => `Or, when you cannot do the job, line 1 \`STATUS: ESCALATE\` and line 2 \`${label}: <one line why>\` (labels: ${labelsFor(role)}).`;

const FORMAT: Record<string, string> = {
  recon: [
    'Line 1 `STATUS: DONE`, then this front matter (one `key: value` per line; JSON for lists and quoted strings):',
    '```', 'STATUS: DONE', '---', 'origin: brownfield', 'ui_surface: true', 'ui_reference: "src/components (the repo\'s own kit)"', '---', '```',
    '`ui_reference` is optional. After the closing `---`, a short markdown map of the repo: stack, how to install, start and test it, layout, conventions.',
    ESCALATE('Scope change', 'recon'),
  ].join('\n'),
  framer: [
    'Line 1 `STATUS: DONE`, then this front matter (one `key: value` per line; JSON for lists and quoted strings):',
    '```', 'STATUS: DONE', '---', 'origin: greenfield', 'ui_surface: true', `ui_reference: "${DEFAULT_UI_KIT}"`, '---', '```',
    `\`origin\` is always greenfield. \`ui_surface\` is true when the task has a page or component a user sees; then \`ui_reference\` names the UI kit the project will use: ${DEFAULT_UI_KIT} unless the task calls for another. Leave \`ui_reference\` out without a UI surface. After the closing \`---\`, a short markdown frame of the project to create: the stack, how to install, start and test it, and the layout.`,
    'Ask the human nothing, and never escalate: choose what the task leaves open yourself, and say what you chose in the frame.',
  ].join('\n'),
  scaffolder: [
    'Line 1 `STATUS: DONE`, then the run contract as front matter (JSON for lists and for strings with spaces):',
    '```', 'STATUS: DONE', '---', 'install: "npm ci"', 'add: "npm install --save-exact"', 'start: "npm run dev"', 'url: "http://localhost:<port>"',
    'port: <port>', 'test: "npm test"', 'health: "curl -fsS http://localhost:<port>/"', 'copy_gitignored: [".env"]', 'services: [{"name": "postgres", "shared": true}]', '---', '```',
    '`port` must be exactly the claimed port above, and `start` must read it from the PORT environment variable and run the server in the foreground (no `&`, no detach or daemon flag): the factory owns the process and stops it. `health` is a command (or an http URL) that succeeds once the app serves. `copy_gitignored` lists the gitignored files (like `.env`) the app needs; the CLI copies them. The factory runs `install` itself in the worktree, before health and test; you install nothing and add no dependency, and change no tracked file: this is a brownfield repo.',
    ESCALATE('Scaffold failed', 'scaffolder'),
  ].join('\n'),
  // SCAFFOLD on a greenfield run (5-2): the same contract, over a project the scaffolder creates.
  'scaffolder:greenfield': [
    'Create the project the frame describes in the worktree, then write line 1 `STATUS: DONE` and its run contract as front matter (JSON for lists and for strings with spaces):',
    '```', 'STATUS: DONE', '---', 'install: "npm install"', 'add: "npm install --save-exact"', 'start: "npm run dev"', 'url: "http://localhost:<port>"',
    'port: <port>', 'test: "npm test"', 'health: "curl -fsS http://localhost:<port>/"', 'copy_gitignored: []', 'services: []', '---', '```',
    'The project has its own test runner with at least one passing test (`test` runs it), and `start` serves the app on the port from the PORT environment variable, in the foreground (no `&`, no detach or daemon flag: the factory owns the process and stops it); `port` must be exactly the claimed port above. Add a `.gitignore` for dependencies and build output. Install dependencies only with the contract\'s own `install` (and `add` for one more); the factory runs `install` again before health and test. `health` is a command (or an http URL) that succeeds once the app serves. `copy_gitignored` is `[]` (the directory had nothing to copy). Never commit: the factory commits the project as the scaffold once its checks pass.',
    ESCALATE('Scaffold failed', 'scaffolder'),
  ].join('\n'),
  'spec-writer': [
    'Line 1 `STATUS: DONE`, then this front matter, then the spec itself as markdown:',
    '```', 'STATUS: DONE', '---', 'acceptance: [{"id": "AC-1", "check": {"kind": "command", "command": "npm test -- footer"}}, {"id": "AC-2", "check": {"kind": "page", "page": "/ shows the footer"}}]',
    'assumptions: ["The footer shows the current year"]', '---', '# <title>', '<what and why, then each AC-<n> in one line>', '## Assumptions', '- The footer shows the current year', '```',
    `The spec body fits one screen: at most ${SPEC_MAX_LINES} lines. Every acceptance criterion has a command or page check. The Assumptions section lists exactly the assumptions[] items, in order: the hidden product decisions the human must check at gate 1.`,
    ESCALATE('Spec ambiguity', 'spec-writer'),
  ].join('\n'),
  designer: [
    'Line 1 `STATUS: DONE`, then this token front matter (one `key: value` per line; nested maps as single-line JSON), then the three sections:',
    '```', 'STATUS: DONE', '---', 'mode: inherit', 'colors: {"primary": "#1f6feb", "surface": "#ffffff", "text": "#1f2328"}', 'typography: {"body": "14px/1.5 system-ui"}',
    'spacing: {"sm": "4px", "md": "8px"}', 'rounded: {"md": "6px"}', 'assumptions: []', '---',
    '## Components to use', '<the components the builder uses, by name and path>', '## States', '<empty, loading, error and success: what each looks like>',
    '## Accessibility floor', '<contrast, focus, labels, keyboard>', '```',
    '`mode` is exactly the designer mode above. `colors` is required; `typography`, `spacing` and `rounded` are optional. Inherit mode: take every token and component from the repo, and ask no question. Invent mode: use the UI system\'s defaults, mark every other decision `[ASSUMPTION]` in the body and list each one in `assumptions`, word for word.',
    'Invent mode only, and never when the notes below say ask no question: you may ask the human at most one question, as one fenced block after the sections, with two options and a default. Write the whole design for the default:',
    '````', '```question', 'question: Light or dark theme?', 'a: Light', 'b: Dark', 'default: a', '```', '````',
    ESCALATE('Spec ambiguity', 'designer'),
  ].join('\n'),
  builder: [
    'Implement the slice in the worktree, then write line 1 `STATUS: DONE` and this front matter:',
    '```', 'STATUS: DONE', '---', 'summary: "Added the footer component to the main page, with a test"', '---', '<optional notes for the reviewer>', '```',
    'Edit only files inside the worktree. Never commit, never run git commands that change history, never start servers: the factory commits your work and runs the tests. Install a dependency only with the run contract\'s `add` command.',
    ESCALATE('Spec ambiguity', 'builder'),
  ].join('\n'),
  slicer: [
    'Line 1 `STATUS: DONE`, then the plan as front matter: one `slices` line holding a single-line JSON list, then a short rationale:',
    '```', 'STATUS: DONE', '---',
    'slices: [{"id": "S1", "title": "Signup form", "acs": ["AC-1", "AC-2"], "tags": ["ui", "input"], "depends_on": []}, {"id": "S2", "title": "Welcome mail", "acs": ["AC-3"], "tags": [], "depends_on": ["S1"]}]',
    '---', 'S2 sends the mail S1\'s form triggers.', '```',
    `Slices are S1, S2, … in build order, each small enough to build and review on its own. \`acs\` lists only the spec's acceptance criteria, and every one of them is in some slice. \`depends_on\` names only earlier slices; leave it empty for an independent slice. \`tags\` only from ${SLICE_TAGS.join(', ')}: ui (a page or component a user sees), input (it parses user or request input), auth (sign-in, sessions, permissions), secrets (keys, tokens, credentials), external (it calls a service outside the app). Tag what the slice touches, nothing else: the factory derives the reviewers from the tags.`,
    ESCALATE('Spec ambiguity', 'slicer'),
  ].join('\n'),
};

// Where a running-app reviewer saves its n-th screenshot of a step: an absolute path in its
// Playwright output dir. @playwright/mcp resolves a bare filename against the client root (the
// worktree), where a builder commit could pick it up.
export const screenshotPath = (role: string, stepId: string, n: number | string): string => join(playwrightDir(role), `${stepId}-${n}.png`);

// The reviewers' shared output format (AD-11); running-app reviewers add `observed:` to each finding,
// and save screenshots at this step's absolute paths.
function reviewerFormat(role: string, stepId = '<step_id>'): string {
  const app = isAppReviewer(role);
  const example = app
    ? ['```finding', 'category: Spec miss', 'location: src/signup.js:40', 'failure_scenario: Submitting the form with an empty email shows no error and clears the form.', `observed: http://localhost:5173/signup after submitting an empty form [${screenshotPath(role, stepId, 1)}]`, '```']
    : ['```finding', 'category: Bug', 'location: src/footer.js:12', 'failure_scenario: On a page without <main>, render() throws and the page is blank.', '```'];
  return [
    'Line 1 is your verdict: `VERDICT: APPROVE` when nothing must change, or `VERDICT: FINDINGS` followed by one fenced block per finding:',
    '````', 'VERDICT: FINDINGS', '', ...example, '````',
    `The charter: report a finding only with a concrete failure scenario, and only in one of these categories: ${FINDING_CATEGORIES.join(', ')} (Spec miss = an acceptance criterion not met; Security = a real exploit path; Breakage = failing tests or a convention a maintainer would reject). No nitpicks: every finding is must-fix. \`APPROVE\` has no finding block; \`FINDINGS\` has at least one. Inside a block: category, location (\`<path>:<line>\`) and failure_scenario${app ? ', then `observed: <url> <state> [<screenshot>]`: the page you saw, the state it was in, and a screenshot path if you took one' : ''}, one per line, in that order.`,
    app
      ? `Save each screenshot at \`${screenshotPath(role, stepId, '<n>')}\` (n = 1, 2, …): always pass that whole absolute path as the screenshot's filename, never a bare name (a bare name lands in the worktree). Cite the same path in \`observed\`.`
      : 'The factory may restart the dev server while you review: don\'t rely on it (the slice\'s tests already passed).',
    ...(role === 'reviewer-a11y' ? ['Report objective accessibility failures only (a missing label or name, no keyboard path, focus lost or invisible, contrast below WCAG AA, a wrong role), never taste.'] : []),
    'Or, when you cannot review, line 1 `VERDICT: ESCALATE` and line 2 `<Label>: <one line why>` (labels: ' + labelsFor(role) + ').',
  ].join('\n');
}
for (const role of REVIEWERS) FORMAT[role] = reviewerFormat(role);

const quote = (s: string): string => s.split('\n').map((l) => `> ${l}`).join('\n');

// The commands of the current slice plan (after the last gate_2_passed): a rerun's new plan reuses
// S1, S2…, so slice-scoped notes of the old plan must not reach it (3-4).
const planCommands = (commands: readonly AnyEvent[]): readonly AnyEvent[] => commands.slice(commands.findLastIndex((e) => e.kind === 'gate_2_passed') + 1);

// Notes typed with every `/factory rework gate1 <note…>`, oldest first.
export function reworkNotes(commands: readonly AnyEvent[], target: string): string[] {
  return commands.filter((e) => e.kind === 'rework_requested' && (e as Envelope<'rework_requested'>).data.target === target)
    .map((e) => (e as Envelope<'rework_requested'>).data.note);
}

// The designer's notes (3-2), in command order so the newest is last: every gate-1 rework note, and
// the human's answer to the design question (the chosen option; no second question may be asked).
export function designerNotes(state: RunState, commands: readonly AnyEvent[]): string[] {
  const asked = latestStep(state, (st) => st.role === 'designer' && Boolean(st.output?.question));
  const q = asked?.output?.question as { question?: string; a?: string; b?: string } | undefined;
  const out: string[] = [];
  for (const e of commands) {
    if (e.kind === 'rework_requested' && (e as Envelope<'rework_requested'>).data.target === 'gate1') out.push((e as Envelope<'rework_requested'>).data.note);
    if (e.kind !== 'design_choice_made') continue;
    const choice = (e as Envelope<'design_choice_made'>).data.choice;
    const option = q ? q[choice as 'a' | 'b'] : undefined;
    out.push(`/factory choose ${choice}${q?.question ? ` (${q.question})` : ''}: option ${choice}${option ? ` — ${option}` : ''}. Write the design for option ${choice}, and ask no question.`);
  }
  return out;
}

// Every `/factory rule E<n> retry <note…>` on an escalation about a step of this role, with the
// card's reason, oldest first: later reissues of the role keep them. With a slice (3-4), only the
// escalations about that slice: a step of it, or the slice itself (an Over time box retry, whose
// note goes to the slice's builder).
export function retryNotes(state: RunState, commands: readonly AnyEvent[], role: string, slice?: string): string[] {
  const out: string[] = [];
  for (const e of slice ? planCommands(commands) : commands) {
    if (e.kind !== 'escalation_ruled') continue;
    const d = (e as Envelope<'escalation_ruled'>).data;
    const m = /^retry(?:\s+([\s\S]*))?$/.exec(d.choice);
    const ask = m ? Object.values(state.asks).find((a) => a.escalation === d.escalation) : undefined;
    if (!m || !ask) continue;
    const subject = ask.step_id ? state.steps[ask.step_id] : undefined;
    const about = subject ? subject.role === role && (!slice || !subject.slice || subject.slice === slice) : role === 'builder' && Boolean(slice) && ask.slice === slice;
    if (!about) continue;
    const note = m[1]?.trim();
    out.push(`${d.escalation} retry${note ? `: ${note}` : ''}${ask.card.reason ? `\n(why it was sent back: ${ask.card.reason})` : ''}`);
  }
  return out;
}

const SLICE_ROLES: readonly string[] = ['builder', ...REVIEWERS];

// What the previous builder round of a slice failed on: a failing slice test, a failing health
// check, and every reviewer's FINDINGS. The builder's next brief cites each, as text and as input
// paths.
function previousRound(state: RunState, slice: string): { note: string; inputs: [string, string][] } | null {
  const f = roundFailure(state, roundOf(state, slice));
  if (!f) return null;
  if (f.kind === 'test') {
    return { note: `contract.test failed (exit ${String(f.step.output?.exit_code)}) at your last commit. Read its log and make it pass.`, inputs: [['the failing contract.test log', f.step.output_path ?? '']] };
  }
  const notes: string[] = [];
  const inputs: [string, string][] = [];
  if (f.kind === 'health') {
    notes.push(`contract.health failed (exit ${String(f.step.output?.exit_code)}) after the factory restarted the dev server at your last commit: the app does not come up. Read its log and fix it.`);
    inputs.push(['the failing contract.health log', f.step.output_path ?? '']);
  }
  for (const st of f.findings) {
    const list = Array.isArray(st.output?.findings) ? (st.output!.findings as Finding[]) : [];
    const text = list.map((x, i) => `${i + 1}. ${x.category} at ${x.location}: ${x.failure_scenario}${x.observed ? ` (observed: ${x.observed})` : ''}`).join('\n');
    notes.push(`${st.role} returned FINDINGS. Fix every one:\n${text}`);
    inputs.push([`${st.role}'s findings`, st.output_path ?? '']);
  }
  return { note: notes.join('\n\n'), inputs };
}

// Notes typed with every `/factory rework gate2 <note…>`, for the slicer (3-3).
const slicerNotes = (commands: readonly AnyEvent[]): string[] => reworkNotes(commands, 'gate2');

// The orientation agents (RECON, FRAME) run in the main checkout, before the worktree and the port.
const orienting = (role: string): boolean => role === 'recon' || role === 'framer';

function inputs(state: RunState, step: BriefStep, root: string, repair?: BriefRepair): [string, string][] {
  const out: [string, string][] = [];
  const context = state.recon?.path ?? latestByRole(state, state.greenfield ? 'framer' : 'recon')?.output_path;
  const contract = latestStep(state, (st) => st.role === 'scaffolder' && st.output?.status === 'DONE');
  const spec = latestSpec(state);
  if (step.role === 'recon') out.push(['the repo (main checkout; read only, change nothing)', root]);
  if (step.role === 'framer') out.push(['the directory the project goes in (main checkout; read only, change nothing)', root]);
  if (!orienting(step.role) && context) out.push([state.greenfield ? 'project frame from FRAME' : 'repo context from RECON', context]);
  if ((SLICE_ROLES.includes(step.role) || step.role === 'slicer') && spec?.output_path) out.push(['the approved spec (pinned at gate 1)', spec.output_path]);
  const design = step.role === 'builder' || step.role === 'slicer' || step.role === 'reviewer-ui' ? latestDesign(state) : undefined;
  if (design?.output_path) out.push(['the approved design (pinned at gate 1)', design.output_path]);
  if ((step.role === 'spec-writer' || step.role === 'builder' || isAppReviewer(step.role)) && contract?.output_path) out.push(['run contract from SCAFFOLD', contract.output_path]);
  if (!orienting(step.role) && state.worktree) out.push(['the worktree (product code)', state.worktree]);
  // 8-1 (AD-15): the tracked files the sandbox refused to check out are missing from the worktree;
  // each is read from the main checkout, and nothing may change it.
  if (!orienting(step.role)) {
    for (const p of state.readonly_paths ?? []) out.push([`${p}, read only in this run (missing from the worktree: the sandbox refuses it there; read it here, change nothing)`, inCheckout(root, p)]);
  }
  if (step.role === 'builder' && step.slice) {
    for (const input of previousRound(state, step.slice)?.inputs ?? []) if (input[1]) out.push(input);
  }
  if (step.role === 'slicer') {
    const prior = latestStep(state, (st) => st.role === 'slicer' && isVoided(state, st.id));
    if (prior?.output_path) out.push(['the previous slice plan, sent back at gate 2', prior.output_path]);
  }
  if (step.role === 'spec-writer') {
    const prior = latestStep(state, (st) => st.role === 'spec-writer' && isVoided(state, st.id));
    if (prior?.output_path) out.push(['the previous spec, sent back at gate 1', prior.output_path]);
  }
  if (step.role === 'designer') {
    const prior = latestStep(state, (st) => st.role === 'designer' && isVoided(state, st.id));
    if (prior?.output_path) out.push(['the previous design, sent back (a gate-1 rework or the other option chosen)', prior.output_path]);
  }
  if (repair) {
    for (const id of repair.checks) {
      const ck = state.steps[id];
      if (ck?.output_path) out.push([`the failed ${ck.check ?? 'check'} log`, ck.output_path]);
    }
    const prev = state.steps[repair.previous]?.output_path;
    if (prev) out.push(['your previous run contract, whose checks failed', prev]);
  }
  return out;
}

// The roles that build what INTAKE agreed get the agreed task and its scope (human text, so
// redacted like the notes); the others, and any run without a recorded intake, keep the task
// `factory start` was given.
const SCOPED_ROLES = ['spec-writer', 'designer', 'slicer', 'builder'];
const scopeList = (xs: readonly string[] | undefined): string => (xs?.length ? xs.join('; ') : '—');
function taskFacts(state: RunState, role: string, values: readonly string[]): string[] {
  const i = state.intake;
  if (!SCOPED_ROLES.includes(role) || !i) return [`task: ${state.task}`];
  return [
    i.task ? `task (agreed at intake): ${i.task}` : `task: ${state.task}`,
    `in scope: ${scopeList(i.scope?.in)}`,
    `out of scope (do none of it): ${scopeList(i.scope?.out)}`,
  ].map((f) => redactString(f, values));
}

// Only the human's notes and the error text are redacted: paths, ports and the format must stay exact.
export function briefText(state: RunState, commands: readonly AnyEvent[], step: BriefStep, root: string, extra: BriefExtra = {}, values: readonly string[] = []): string {
  const facts: string[] = [...taskFacts(state, step.role, values), `run: ${state.run_id} (branch ${state.branch}, base ${state.base_sha})`];
  if (state.port !== undefined && !orienting(step.role)) facts.push(`claimed port: ${state.port}`);
  if (state.worktree && !orienting(step.role)) facts.push(`worktree: ${state.worktree}`);
  if (step.role === 'scaffolder' && state.repo_hash && state.run_id) {
    facts.push(`FACTORY_CACHE_DIR: ${runCacheDir(state.repo_hash, state.run_id)} (the run's own tool cache: every contract command the factory runs gets it in its environment)`);
  }
  const repair = repairOf(step.role, commands, extra);
  const sl = step.slice ? state.slices[step.slice] : undefined;
  if (sl) {
    facts.push(`slice: ${sl.id} ${sl.title ?? ''}`.trim(), `acceptance criteria of ${sl.id}: ${(sl.acs ?? []).join(', ') || 'none'}`);
    for (const n of sl.notes ?? []) facts.push(`slice note (gate 2): ${redactString(n, values)}`);
  }
  if (step.role === 'designer') {
    facts.push(`designer mode: ${designMode(state)}`);
    const ref = state.recon?.context?.ui_reference;
    if (typeof ref === 'string' && ref) facts.push(`ui_reference: ${ref}`);
  }
  if (sl && (sl.tags?.length || sl.roster)) facts.push(`tags of ${sl.id}: ${sl.tags?.join(', ') || 'none'}`);
  if (isDiffReviewer(step.role) && sl) {
    // 3-4: another slice may be built in the same worktree meanwhile, so the code is read at the
    // slice's sha, never from the working tree.
    const sha = roundOf(state, sl.id).builder?.sha ?? 'HEAD';
    const own = sliceDeps(state, sl.id);
    const building = state.slice_order.filter((id) => id !== sl.id && state.slices[id].state === 'BUILDING');
    facts.push(`review this diff: git diff ${state.base_sha}..${sha} (run it in the worktree; its tests pass at ${sha})`);
    // The range also holds other slices' commits (every earlier slice, and one built between this
    // slice's rounds): only this slice's own commits are under review.
    if (own.length) facts.push(`${sl.id}'s own commits: ${own.join(', ')}. Review only the changes these commits make (\`git show <commit>\`); the rest of that diff is other slices' work, context only: report no finding on it`);
    facts.push(`read the code at ${sha}: \`git show ${sha}:<path>\`, never from the working tree, which may hold another slice's work in progress`);
    facts.push(building.length
      ? `${building.join(', ')} is being built in the worktree right now: run no tests (they already passed at ${sha})`
      : `no other slice is being built in the worktree right now: you may run the tests (they passed at ${sha})`);
  }
  if (isAppReviewer(step.role) && sl) {
    // The run's single dev server, which the factory restarted at the slice head and health-checked.
    const c = contractOf(state);
    facts.push(`the running app: ${typeof c?.url === 'string' ? c.url : '(the run contract url)'} (the factory's dev server at the slice head; never start or stop a server)`);
    facts.push(`browser driver: your own Playwright MCP tools, ${appReviewerTools(step.role).join(', ')}; call browser_close first, so you start from a fresh browser context`);
    if (typeof c?.e2e === 'string' && c.e2e.trim()) facts.push(`the repo's e2e tooling: \`${c.e2e}\` (read its tests in the worktree and follow their flows)`);
  }
  if (step.role === 'reviewer-ui') {
    const ref = uiReference(state);
    if (ref) facts.push(`reference to compare the running app against: ${ref}`);
    // Greenfield (5-2): the UI kit FRAME chose is a reference too, beside the invented design.
    const kit = state.recon?.context?.ui_reference;
    if (state.greenfield && typeof kit === 'string' && kit && kit !== ref) facts.push(`UI kit chosen at FRAME (reference): ${kit}`);
  }
  if (step.role === 'reviewer-ux' && sl) {
    const ref = uiReference(state);
    facts.push(sliceRoster(sl).includes('reviewer-ui')
      ? `reviewer-ui is on this slice's roster${ref ? ` (reference: ${ref})` : ''}: leave rendering against the reference to it`
      : 'reviewer-ui is not on this slice\'s roster: the broken-rendering checks are yours alone');
  }
  const prev = step.role === 'builder' && sl ? previousRound(state, sl.id) : null;
  const notes = [
    ...(step.role === 'spec-writer' ? reworkNotes(commands, 'gate1') : []),
    ...(step.role === 'designer' ? designerNotes(state, commands) : []),
    ...(step.role === 'slicer' ? slicerNotes(commands) : []),
    ...(step.role === 'builder' && sl ? reworkNotes(planCommands(commands), sl.id) : []),
    ...retryNotes(state, commands, step.role, step.slice), ...(extra.notes ?? []),
  ].map((n) => redactString(n, values));
  const parts = [
    `# Brief — d2t-factory:${step.role}`,
    `step ${step.id} · stage ${step.stage} · attempt ${step.attempt}`,
    '', '## Facts', ...facts.map((f) => `- ${f}`),
    '', '## Read only these inputs', ...inputs(state, step, root, repair).map(([label, p]) => `- ${label}: ${p}`),
    '', '## Write exactly one file', `${step.output_path}`, `Write it with the Write tool. Write nothing else under ~/.factory${isAppReviewer(step.role) ? ' except your screenshots, at the paths the output format below gives' : ''}, and never run \`factory\`.`,
    'Run every command inside the sandbox: never set `dangerouslyDisableSandbox`. If the sandbox blocks something you need, report it as your failure or escalation; don\'t work around it, and don\'t ask for a sandbox or permission change.',
    '', '## Output format', isAppReviewer(step.role) ? reviewerFormat(step.role, step.id) : FORMAT[step.role === 'scaffolder' && state.greenfield ? 'scaffolder:greenfield' : step.role] ?? 'Line 1 `STATUS: DONE|ESCALATE`.',
  ];
  if (prev) parts.push('', `## Your last round on ${sl!.id} did not pass`, quote(redactString(prev.note, values)));
  if (repair) {
    parts.push('', '## Repair round',
      'The factory ran your run contract and these checks failed (their logs and your previous contract are among the inputs):',
      ...repair.failures.map((f) => quote(redactString(f, values))),
      REPAIR_ENVELOPE,
      'If the cause is on the project\'s side (secrets, services, a broken repo), write line 1 `STATUS: ESCALATE` and line 2 `Scaffold failed: <why>`. Otherwise write the whole revised contract.');
  }
  if (notes.length) parts.push('', '## Notes from the human (newest last)', ...notes.map(quote));
  if (extra.error) parts.push('', '## Your previous output was rejected', quote(redactString(extra.error, values)), 'Fix exactly this and write the whole file again.');
  return parts.join('\n') + '\n';
}

// Written before the step_issued/step_reissued that names it, so a brief never goes missing.
export function writeBrief(hash: string, runId: string, state: RunState, commands: readonly AnyEvent[], step: BriefStep, root: string, extra: BriefExtra = {}): string {
  const file = briefFile(hash, runId, step.id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, briefText(state, commands, step, root, extra, readRedactValues(hash, runId)));
  return file;
}

// --- the INTAKE brief (3-1) -------------------------------------------------------------------
// Conductor-shaped, unlike briefText (which is an agent's and says never to run factory): the
// conductor converses with the human in chat, writes the intake out.md and runs `factory done`.

export interface IntakeBriefStep { id: string; output_path: string }

export function intakeBriefText(state: RunState, step: IntakeBriefStep): string {
  const tb = SLICE_TIMEBOX_DEFAULT_MS / 60_000;
  return [
    '# Brief — INTAKE (the conductor)',
    `step ${step.id} · stage INTAKE`,
    '', '## Facts', `- task: ${state.task}`, `- run: ${state.run_id} (branch ${state.branch}, base ${state.base_sha})`,
    '', '## Agree these with the human, in chat',
    'Ask in one short message, then end the turn and wait for the answer; no spec file exists until the human confirms. Settle the task, its scope and the settings, and anything else the human stresses about the task:',
    '- `task`: the task as agreed, in one line.',
    '- `scope`: what is in scope and what is out of scope, as two lists of short items (`in` and `out`; either may be empty).',
    `- \`limit_min\` (optional): ask whether this task has a time limit, in minutes (2:00 is 120). Leave it out when there is none: then there is no budget clock and no cut. With a limit, the budget clock never pauses; at limit − ${CUT_LEAD_MS / 60_000} min with slices unbuilt the human is asked what to cut.`,
    '- `started` (only with a limit): when that time limit\'s clock started, if before this run, as a JSON string in ISO-8601 with its zone (UTC `Z` or `±hh:mm`); leave it out otherwise. The clock then runs from the earlier of that and the run start.',
    `- \`slice_timebox_min\`: the time box per slice, in minutes (${tb} when the human has no preference).`,
    '- `ui_free`: true when the task touches no UI, so no designer and no UI reviewers run.',
    `- \`reviewer_overrides\`: run-wide changes to the reviewer roster: \`add\` and \`remove\` among ${OVERRIDE_ROLES.join(', ')}. reviewer-code always runs.`,
    '', '## Write exactly one file', step.output_path,
    'Write it with the Write tool, and nothing else under ~/.factory.',
    '', '## Output format',
    '```', 'STATUS: DONE', '---', 'task: "<the task, in one line>"', 'scope: {"in": ["<in scope>"], "out": ["<out of scope>"]}', 'limit_min: 120', `slice_timebox_min: ${tb}`, 'ui_free: false', 'reviewer_overrides: {"add": [], "remove": []}',
    '---', '<the task as agreed, constraints, anything the human stressed>', '```',
    'One `key: value` per line; JSON for the objects and for quoted strings. Leave out the `limit_min` line when there is no time limit. Add a `started` line only with a limit, and only when its clock started before this run.',
    '', '## Then',
    'Run `factory done` with this step\'s step_id from `next`. A MISSING_EVIDENCE answer names what to fix: fix the file and run the same done again. The CLI then shows the human a confirm card with the task, scope and settings. If the human changes anything before approving, rewrite the file and run `factory done` with the step_id the last done returned.',
  ].join('\n') + '\n';
}

// Written before the step_issued that names it.
export function writeIntakeBrief(hash: string, runId: string, state: RunState, step: IntakeBriefStep): string {
  const file = briefFile(hash, runId, step.id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, intakeBriefText(state, step));
  return file;
}
