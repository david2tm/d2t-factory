import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { intakeCard, intakeConfirmCard } from '../src/core/cards.ts';
import { initialState, type RunState, type Step } from '../src/core/reducer.ts';
import { callsFactory, decide, isPlainFactory, pathCandidates, SANDBOX_DENY, tokenize, writableDirs, type GuardContext } from '../src/hooks/guard.ts';
import { isUnder, realish } from '../src/store/paths.ts';

const H = '/home/u';

test('tokenize splits words, removes quotes and expands ~ and $HOME', () => {
  const sh = tokenize(`factory done 01ABC --note 'it''s "ok"' "a b" ~/x $HOME/y \${HOME}/z $HOMEX`, H);
  assert.deepEqual(sh.words, ['factory', 'done', '01ABC', '--note', `its "ok"`, 'a b', '/home/u/x', '/home/u/y', '/home/u/z', '$HOMEX']);
  assert.deepEqual(sh.commandWords, ['factory']);
  assert.deepEqual(sh.operators, []);
  assert.equal(sh.substitution, false);
  assert.deepEqual(tokenize('cat "$HOME/.factory/a"', H).words, ['cat', '/home/u/.factory/a']);
  assert.deepEqual(tokenize("echo '~/x' \\~/y a~/z", H).words, ['echo', '~/x', '~/y', 'a~/z']);
});

test('tokenize finds operators, redirections, command words and substitutions', () => {
  const a = tokenize('FOO=1 factory next && echo hi > /tmp/o 2>&1 | tee x; ls', H);
  assert.deepEqual(a.commandWords, ['factory', 'echo', 'tee', 'ls']);
  assert.deepEqual(a.redirects, ['/tmp/o', '1']);
  assert.deepEqual(a.operators, ['&&', '>', '>&', '|', ';']);
  assert.equal(tokenize('factory next "$(cat x)"', H).substitution, true);
  assert.equal(tokenize('factory next "`id`"', H).substitution, true);
  assert.equal(tokenize('diff <(ls) x', H).substitution, true);
  assert.equal(tokenize("factory next '$(x)'", H).substitution, false, 'single quotes are literal');
  assert.equal(tokenize('factory next # trailing', H).comment, true);
  assert.equal(tokenize('factory next "open', H).unterminated, true);
  assert.deepEqual(tokenize('a\nfactory b', H).commandWords, ['a', 'factory']);
  const c = tokenize('# note\necho x > /p', H);
  assert.deepEqual([c.comment, c.commandWords, c.redirects, c.operators], [true, ['echo'], ['/p'], ['\n', '>']]);
});

test('the factory exemption needs one plain simple command', () => {
  const plain = (s: string): boolean => isPlainFactory(tokenize(s, H));
  assert.equal(plain('factory next --session abc'), true);
  assert.equal(plain('factory done 01X --note "all good: see /tmp/x"'), true);
  for (const s of [
    'factory next; rm -rf x', 'factory next && x', 'factory next | tee', 'factory next > /tmp/o', 'factory next < in',
    'factory "$(echo next)"', 'factory next `id`', "factory done X --note '$(rm)'", 'factory next <(x)', 'factory next &',
    'FOO=1 factory next', '/usr/bin/factory next', 'factory next # c', 'factory next "x', ' (factory next)', 'factory next\nrm x', 'xfactory next',
  ]) assert.equal(plain(s), false, s);
});

test('callsFactory sees factory as any command word, by basename', () => {
  for (const s of ['factory next', 'cd x && factory next', 'ls | /opt/bin/factory status', 'FOO=1 factory next']) assert.equal(callsFactory(tokenize(s, H)), true, s);
  for (const s of ['echo factory', 'cat factory.md', 'ls']) assert.equal(callsFactory(tokenize(s, H)), false, s);
});

test('pathCandidates takes slashy words, --flag=path, a:b parts and every redirection target', () => {
  const c = pathCandidates(tokenize('cp a.txt --out=/x/y k:/p/q > target 2>err ./rel ~/h plain', H));
  for (const want of ['/x/y', '/p/q', 'target', 'err', './rel', '/home/u/h']) assert.ok(c.includes(want), want);
  assert.ok(!c.includes('plain') && !c.includes('cp'));
});

// --- decide against a real tree ---------------------------------------------------------------

function tree() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-guard-')));
  const home = join(base, '.factory');
  const projects = join(base, 'projects');
  const step = join(home, 'h', 'runs', 'r', 'artifacts', 'steps', 'S1');
  mkdirSync(step, { recursive: true });
  mkdirSync(projects);
  const repo = join(base, 'repo');
  mkdirSync(repo);
  const ctx = (fromAgent = false): GuardContext => ({ cwd: repo, protectedRoots: [home, projects], allowedDirs: [step], fromAgent });
  return { base, home, projects, step, repo, ctx };
}

test('writes under a protected root are denied unless inside a claimed step dir', () => {
  const t = tree();
  const w = (fp: string, tool = 'Write'): boolean => decide(tool, { file_path: fp }, t.ctx(true)).deny;
  assert.equal(w(join(t.step, 'out.md')), false);
  assert.equal(w(join(t.step, 'deep', 'new', 'out.md')), false, 'missing tail under the step dir');
  assert.equal(w(join(t.home, 'inbox', 's.jsonl')), true);
  assert.equal(w(join(t.home, 'h', 'runs', 'r', 'commands.jsonl'), 'Edit'), true);
  assert.equal(w(join(t.projects, '-repo', 's.jsonl'), 'MultiEdit'), true);
  assert.equal(decide('NotebookEdit', { notebook_path: join(t.home, 'n.ipynb') }, t.ctx()).deny, true);
  assert.equal(w(join(t.repo, 'src', 'a.ts')), false);
  assert.equal(w(join(t.step, '..', 'S2', 'out.md')), true, 'dot-dot out of the step dir');
  assert.equal(w('../.factory/inbox/x'), true, 'relative to cwd');
  assert.equal(decide('Read', { file_path: join(t.home, 'inbox', 's.jsonl') }, t.ctx()).deny, false, 'reads are not guarded');
});

test('symlinks resolve through their target, even a dangling one', () => {
  const t = tree();
  symlinkSync(t.home, join(t.repo, 'link'));
  symlinkSync(join(t.home, 'inbox', 'new.jsonl'), join(t.repo, 'dangling'));
  symlinkSync('../.factory/inbox', join(t.repo, 'rel'));
  for (const fp of [join(t.repo, 'link', 'inbox', 'x'), join(t.repo, 'dangling'), join(t.repo, 'rel', 'x.jsonl')]) {
    assert.equal(decide('Write', { file_path: fp }, t.ctx()).deny, true, fp);
  }
  assert.equal(realish(join(t.repo, 'dangling')), join(t.home, 'inbox', 'new.jsonl'));
});

test('case is folded on darwin', { skip: process.platform !== 'darwin' && 'case-insensitive volumes only' }, () => {
  const t = tree();
  const upper = t.home.replace('.factory', '.FACTORY');
  assert.equal(decide('Write', { file_path: join(upper, 'inbox', 'x') }, t.ctx()).deny, true);
  assert.equal(isUnder(join(upper, 'x'), t.home), true);
});

test('Bash: the conductor\'s plain factory call passes; a subagent\'s factory call is denied', () => {
  const t = tree();
  const b = (command: string, agent = false): boolean => decide('Bash', { command }, t.ctx(agent)).deny;
  assert.equal(b(`factory done S1 --note "wrote ${t.home}/x"`), false);
  assert.equal(b('factory next --session s'), false);
  assert.equal(b('factory next --session s', true), true);
  assert.equal(b('cd /tmp && factory next', true), true);
  assert.equal(b(`factory done S1 --note "$(cat ${t.home}/inbox/s.jsonl)"`), true, 'substitution loses the exemption');
  assert.equal(b('factory next > /tmp/x'), false, 'no exemption, but no protected path either');
});

test('Bash outside the sandbox is denied for the conductor and agents; false or absent runs the usual checks (7-1)', () => {
  const t = tree();
  const b = (input: Record<string, unknown>, agent = false) => decide('Bash', input, t.ctx(agent));
  assert.deepEqual(b({ command: 'git merge --no-ff x', dangerouslyDisableSandbox: true }), { deny: true, reason: SANDBOX_DENY });
  assert.deepEqual(b({ command: 'npm ci', dangerouslyDisableSandbox: true }, true), { deny: true, reason: SANDBOX_DENY });
  assert.equal(b({ command: 'factory next --session s', dangerouslyDisableSandbox: true }).deny, true, 'not even the plain factory exemption');
  assert.equal(b({ command: 'npm ci', dangerouslyDisableSandbox: false }, true).deny, false);
  assert.equal(b({ command: 'factory next --session s', dangerouslyDisableSandbox: false }).deny, false);
  assert.match((b({ command: `echo x > ${t.home}/inbox/s`, dangerouslyDisableSandbox: false }) as { reason: string }).reason, /factory-owned/);
  assert.equal(b({ command: 'npm ci', dangerouslyDisableSandbox: 'true' }).deny, false, 'only a real true');
});

test('outside the sandbox is denied on any tool that takes the flag, not only Bash', () => {
  const t = tree();
  for (const tool of ['Monitor', 'PowerShell', 'Write', 'SomeFutureTool']) {
    assert.deepEqual(decide(tool, { command: 'npm ci', file_path: '/tmp/x', dangerouslyDisableSandbox: true }, t.ctx(false)), { deny: true, reason: SANDBOX_DENY }, tool);
    assert.deepEqual(decide(tool, { command: 'npm ci', dangerouslyDisableSandbox: true }, t.ctx(true)), { deny: true, reason: SANDBOX_DENY }, `${tool} from an agent`);
  }
  assert.equal(decide('Monitor', { command: 'tail -f log', dangerouslyDisableSandbox: false }, t.ctx(false)).deny, false);
  assert.equal(decide('PowerShell', { command: 'Get-ChildItem' }, t.ctx(false)).deny, false);
});

test('Bash: any word resolving under a protected root is denied, except claimed step dirs', () => {
  const t = tree();
  const b = (command: string): boolean => decide('Bash', { command }, t.ctx(true)).deny;
  assert.equal(b(`echo x >> ${t.home}/inbox/s.jsonl`), true);
  assert.equal(b(`cat <<'EOF' > "${t.home}/inbox/s.jsonl"\nline\nEOF`), true);
  assert.equal(b(`cp a ${t.projects}/-repo/s.jsonl`), true);
  assert.equal(b(`python3 -c 'open("x")' --out=${t.home}/a`), true);
  assert.equal(b(`ln -s ${t.home}/inbox here`), true);
  assert.equal(b(`echo ok > ${t.step}/out.md`), false);
  assert.equal(b('npm test && git status'), false);
  assert.equal(b(`# note\necho x > ${t.home}/inbox/s`), true, 'a comment line does not hide the next line');
  assert.equal(b('# only a comment'), false);
  assert.equal(b(`curl -o${t.home}/inbox/s https://x`), true, 'a path glued to a short flag');
  assert.equal(b(`gcc -I${t.step} -c a.c`), false, 'glued flag into the claimed step dir');
  assert.equal(b(`echo ok > ${t.repo}/link/x`), false, 'link does not exist yet: nothing to resolve');
  symlinkSync(t.home, join(t.repo, 'link'));
  assert.equal(b('echo ok > link/inbox/x'), true, 'relative redirection through a symlink');
});

test('writable dirs: each claimed step, and the open INTAKE conversation\'s out.md dir while it is claimed or reported (a re-report keeps the same out.md)', () => {
  const s: RunState = { ...initialState(), run_id: 'r' };
  const add = (st: Partial<Step> & { id: string }): void => { s.steps[st.id] = { kind: 'spawn', stage: 'RECON', attempt: 1, state: 'issued', issued_seq: 0, ...st }; s.step_order.push(st.id); };
  const dir = (id: string): string => `/h/steps/${id}`;
  add({ id: 'A', state: 'claimed' });
  add({ id: 'B', state: 'reported' });
  add({ id: 'I1', kind: 'ask_human', stage: 'INTAKE', state: 'reissued', card: intakeCard(), output_path: '/h/steps/I1/out.md' });
  add({ id: 'I2', kind: 'ask_human', stage: 'INTAKE', state: 'reported', card: intakeCard(), output_path: '/h/steps/I1/out.md' });
  add({ id: 'C', kind: 'ask_human', stage: 'INTAKE', state: 'claimed', card: intakeConfirmCard({ limit_min: 60, slice_timebox_min: 30, ui_free: false, reviewer_overrides: { add: [], remove: [] } }) });
  assert.deepEqual(writableDirs(s, dir), ['/h/steps/A', '/h/steps/C', '/h/steps/I1']);
  s.steps.I2.state = 'issued'; // not claimed yet
  assert.deepEqual(writableDirs(s, dir), ['/h/steps/A', '/h/steps/C']);
  s.steps.I2.state = 'verified'; // approved: the intake is pinned
  assert.deepEqual(writableDirs(s, dir), ['/h/steps/A', '/h/steps/C']);
});
