// Writes the reducer fixtures (test/fixtures/*.jsonl) and, from each, a fixture recording
// (test/fixtures/recordings/<scenario>/, 4-1). Run once after changing a scenario:
//   node test/fixtures/generate.ts && UPDATE_SNAPSHOTS=1 node --test test/
// IDs and timestamps are deterministic so the folded snapshots stay byte-identical (AD-32).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEvent } from '../../src/core/events.ts';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RUN = 'add-login-page-q7k2';
const SESSION = '11111111-2222-4333-8444-555555555555';

function makeWriter() {
  let n = 0;
  const lines: object[] = [];
  const id = (): string => {
    let x = n++;
    let s = '';
    for (let i = 0; i < 6; i++) { s = B32[x % 32] + s; x = Math.floor(x / 32); }
    return '01JQ000000000000000000' + s.slice(2);
  };
  const ts = (): string => new Date(Date.UTC(2026, 9, 24, 9, 0, 0) + n * 1000).toISOString();
  let last = '';
  const emit = (kind: string, data: object, extra: { actor?: string; corr?: string; session?: string } = {}): string => {
    const e = { v: 1, id: id(), ts: ts(), run: RUN, session: extra.session, kind, actor: extra.actor ?? 'cli', corr: extra.corr ?? last ?? null, data };
    if (e.session === undefined) delete (e as { session?: string }).session;
    const r = validateEvent(e);
    if (!r.ok && !extra.actor?.startsWith('!')) throw new Error(`${kind}: ${r.errors.join('; ')}`);
    lines.push(e);
    last = e.id;
    return e.id;
  };
  const decide = (kind: string, data: object = {}): string =>
    emit(kind, { prompt_fact_id: `fact-${kind}`, ...data }, { actor: 'human', session: SESSION });
  // Issue → claim → report → verify one step; returns its id.
  const fullStep = (stage: string, kind: string, role?: string, slice?: string, verdict?: string): string => {
    const sid = emit('step_issued', { kind, stage, attempt: 1, role, agent: role ? `d2t-factory:${role}` : undefined, slice, output_path: `/x/artifacts/steps/${role ?? kind}/out.md` });
    emit('step_claimed', { step_id: sid, agent_id: role ? `agent-${role}` : undefined }, { corr: sid, session: SESSION });
    emit('step_reported', { step_id: sid, sha: role === 'builder' ? 'b1d0000' : undefined }, { corr: sid, actor: 'conductor', session: SESSION });
    emit('step_verified', { step_id: sid, evidence: ['fact-stop', 'fact-output'], verdict }, { corr: sid });
    return sid;
  };
  return { emit, decide, fullStep, lines };
}

function start(w: ReturnType<typeof makeWriter>): void {
  w.emit('run_started', { task: 'add login page', repo_hash: 'abc123def456', base_sha: 'base000', branch: `factory/${RUN}` }, { corr: '' });
  w.emit('session_bound', { session: SESSION });
}

function toBuild(w: ReturnType<typeof makeWriter>, slices: string[]): void {
  start(w);
  w.decide('intake_confirmed');
  w.emit('stage_completed', { stage: 'RECON' });
  w.fullStep('SCAFFOLD', 'enter_worktree');
  w.fullStep('SCAFFOLD', 'spawn', 'scaffolder');
  w.fullStep('SPEC', 'spawn', 'spec-writer');
  w.emit('check_ran', { check: 'spec.lint', exit_code: 0, duration_ms: 12, basis_seq: 20 });
  w.decide('gate_1_passed');
  w.fullStep('SLICE_PLAN', 'spawn', 'slicer');
  w.emit('check_ran', { check: 'plan.lint', exit_code: 0, duration_ms: 9, basis_seq: 26 });
  w.decide('gate_2_passed', { slices: slices.map((id) => ({ id, title: `slice ${id}` })) });
}

const scenarios: Record<string, (w: ReturnType<typeof makeWriter>) => void> = {
  'happy-path': (w) => {
    toBuild(w, ['S1']);
    w.emit('slice_started', { slice: 'S1' });
    w.fullStep('BUILD', 'spawn', 'builder', 'S1');
    w.fullStep('BUILD', 'spawn', 'reviewer-code', 'S1', 'APPROVE');
    const chk = w.emit('check_ran', { check: 'contract.test', exit_code: 0, duration_ms: 3200, basis_seq: 40, sha: 'b1d0000' });
    w.emit('slice_closed', { slice: 'S1', check_id: chk });
    w.emit('stage_completed', { stage: 'BUILD' });
    w.decide('merge_approved');
    w.emit('check_ran', { check: 'git.merged', exit_code: 0, duration_ms: 80, basis_seq: 45, sha: 'merge00' });
    w.emit('merged', { sha: 'merge00' });
    w.emit('run_completed', {});
  },
  'findings-escalation-rework': (w) => {
    toBuild(w, ['S1', 'S2']);
    w.emit('slice_started', { slice: 'S1' });
    w.fullStep('BUILD', 'spawn', 'builder', 'S1');
    w.fullStep('BUILD', 'spawn', 'reviewer-code', 'S1', 'FINDINGS');
    const resume = w.emit('step_issued', { kind: 'resume', stage: 'BUILD', attempt: 1, role: 'builder', agent: 'd2t-factory:builder', agent_id: 'agent-builder', slice: 'S1' });
    w.emit('step_claimed', { step_id: resume }, { corr: resume, session: SESSION });
    w.emit('step_reported', { step_id: resume, sha: 'b2d0000' }, { corr: resume, actor: 'conductor', session: SESSION });
    // The report never gets evidence; the CLI reissues it once (AD-24).
    w.emit('step_reissued', { old: resume, new: '01JQ0000000000000000000ZZZ', output_path: '/x/artifacts/steps/resume-2/out.md' }, { corr: resume });
    w.emit('step_claimed', { step_id: '01JQ0000000000000000000ZZZ' }, { corr: resume, session: SESSION });
    w.emit('ask_raised', { card: { type: 'escalation', title: 'Builder stuck on S1', commands: ['/factory rule E1 continue', '/factory rule E1 close'] }, slice: 'S1', escalation: 'E1' });
    w.decide('escalation_ruled', { escalation: 'E1', choice: 'continue' });
    w.emit('step_reported', { step_id: '01JQ0000000000000000000ZZZ', sha: 'b3d0000' }, { corr: resume, actor: 'conductor', session: SESSION });
    w.emit('step_verified', { step_id: '01JQ0000000000000000000ZZZ', evidence: ['fact-stop-2'] }, { corr: resume });
    const chk = w.emit('check_ran', { check: 'contract.test', exit_code: 0, duration_ms: 3100, basis_seq: 50, sha: 'b3d0000' });
    w.emit('slice_closed', { slice: 'S1', check_id: chk });
    w.decide('cut_decided', { cut: ['S2'] });
    w.decide('rework_requested', { target: 'S1', note: 'button colour', voids: [chk] });
  },
  'illegal-then-abandon': (w) => {
    start(w);
    w.decide('gate_2_passed', { slices: [{ id: 'S1' }] }); // illegal in INTAKE
    w.decide('intake_confirmed');
    const sid = w.emit('step_issued', { kind: 'spawn', stage: 'RECON', attempt: 1, role: 'recon', agent: 'd2t-factory:recon' });
    w.emit('step_claimed', { step_id: sid }, { corr: sid, session: SESSION });
    w.emit('step_claimed', { step_id: sid }, { corr: sid, session: 'other-session' }); // CLAIM_TAKEN
    w.emit('merged', { sha: 'nope' }); // not in WRAP
    w.decide('run_abandoned');
    w.emit('stage_completed', { stage: 'RECON' }); // after terminal
  },
};

const here = dirname(fileURLToPath(import.meta.url));
const built: Record<string, object[]> = {};
for (const [name, build] of Object.entries(scenarios)) {
  const w = makeWriter();
  build(w);
  built[name] = w.lines;
  writeFileSync(join(here, `${name}.jsonl`), w.lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  process.stdout.write(`${name}.jsonl: ${w.lines.length} events\n`);
}

// --- fixture recordings (4-1) --------------------------------------------------------------------
// Each scenario becomes a run under a temp FACTORY_HOME, with hook facts, a redact.json value and a
// secret in a fact, an artifact and the session transcript; then
// `writeRecording` copies it, redacted, and the copy is committed. test/timeline.test.ts holds the
// same constants: no file under the recordings may contain FIXTURE_VALUE or FIXTURE_KEY, and no
// replay response may contain the transcript marker.
const HASH = 'abc123def456';
const FIXTURE_VALUE = 'fixture-dotenv-token-4417'; // a redact.json value
const FIXTURE_KEY = 'sk-fixtureABCDEFGHIJKLMNOPQRSTUV'; // a secret pattern
const RECORDED_AT = '2026-10-25T12:00:00.000Z';
const transcriptMarker = (name: string): string => `transcript-only-${name}`;
const plus = (ts: string, ms: number): string => new Date(Date.parse(ts) + ms).toISOString();

// Hook facts no command cites (the fixtures' evidence ids are not event ids): a session start, a
// tool run carrying both secrets on the ts of intake_confirmed (a tie: the fact replays first), and a
// session end two seconds after the last command.
let factN = 0;
function factsFor(lines: object[]): object[] {
  const cmds = lines as { ts: string; kind: string }[];
  const fact = (kind: string, ts: string, data: object): object => {
    const e = { v: 1, id: `01JQF00000000000000000${String(factN++).padStart(4, '0')}`, ts, run: RUN, session: SESSION, kind, actor: 'hook', corr: null, data };
    const r = validateEvent(e);
    if (!r.ok) throw new Error(`${kind}: ${r.errors.join('; ')}`);
    return e;
  };
  const bound = cmds.find((e) => e.kind === 'session_bound')!;
  const intake = cmds.find((e) => e.kind === 'intake_confirmed')!;
  return [
    fact('session_started', plus(bound.ts, 400), { source: 'startup', cwd: '/x/repo' }),
    fact('tool_succeeded', intake.ts, { tool_name: 'Bash', command: `API_TOKEN=${FIXTURE_VALUE} OPENAI_KEY=${FIXTURE_KEY} npm test`, duration_ms: 12 }),
    fact('session_ended', plus(cmds.at(-1)!.ts, 2000), { reason: 'other' }),
  ];
}

const RECORDINGS = join(here, 'recordings');
const { writeRecording } = await import('../../src/cli/record.ts');
for (const [name, lines] of Object.entries(built)) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-fixture-rec-')));
  process.env.FACTORY_HOME = join(base, '.factory');
  process.env.FACTORY_CLAUDE_PROJECTS = join(base, 'projects');
  const run = join(base, '.factory', HASH, 'runs', RUN);
  const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
  const jsonl = (xs: object[]): string => xs.map((x) => JSON.stringify(x) + '\n').join('');
  put(join(run, 'commands.jsonl'), jsonl(lines));
  put(join(run, 'facts', `${SESSION}-main.jsonl`), jsonl(factsFor(lines)));
  put(join(run, 'redact.json'), JSON.stringify({ values: [FIXTURE_VALUE] }));
  put(join(run, 'artifacts', 'steps', 'enter_worktree', 'out.md'), `STATUS: DONE\nUsed API_TOKEN=${FIXTURE_VALUE} from .env\n`);
  put(join(base, 'projects', '-repo', `${SESSION}.jsonl`), jsonl([
    { type: 'user', sessionId: SESSION, message: { content: `/factory ${transcriptMarker(name)} with ${FIXTURE_VALUE}` } },
    { type: 'assistant', sessionId: SESSION, message: { content: `the key is ${FIXTURE_KEY}` } },
  ]));
  const rec = writeRecording(name, [{ hash: HASH, runId: RUN }]);
  // A deterministic recorded_at; the rest of the manifest is writeRecording's.
  const manifest = join(rec.path, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), recorded_at: RECORDED_AT }, null, 2) + '\n');
  rmSync(join(RECORDINGS, name), { recursive: true, force: true });
  cpSync(rec.path, join(RECORDINGS, name), { recursive: true });
  rmSync(base, { recursive: true, force: true });
  process.stdout.write(`recordings/${name}: ${rec.files} files, transcripts ${rec.transcripts.join(', ')}\n`);
}
