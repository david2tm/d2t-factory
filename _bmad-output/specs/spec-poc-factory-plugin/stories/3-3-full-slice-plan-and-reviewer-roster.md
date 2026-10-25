---
title: 'Full slice plan and reviewer roster'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/specs/spec-poc-factory-plugin/review-policy.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** SLICE_PLAN has no slicer: plan.lint derives one slice S1 with every AC, no tags and no deps. BUILD issues only reviewer-code. So security, UX, accessibility and look are never reviewed, and 3-4 has no slices to pipeline or cut (CAP-7, CAP-9).

**Approach:**
- **Slicer.** On entering SLICE_PLAN the CLI issues `d2t-factory:slicer` (opus). It writes the slice plan as its out.md: front matter `slices: [{id, title, acs, tags, depends_on}]` (AD-27) plus a short rationale.
  - `plan.lint` lints the current slicer plan in place of `deriveSinglePlan`, and adds each slice's derived roster.
  - The gate_2 card shows each slice's tags, deps and roster. `approve gate2` embeds all three in `gate_2_passed.slices`.
  - A gate-2 rework voids the slicer step, its `step_verified` and plan.lint, then respawns the slicer with the note and its previous plan.
- **Roster.** `core/roster.ts` alone derives it, in this order:
  - reviewer-code always.
  - reviewer-security on `input|auth|secrets|external`.
  - reviewer-ux and reviewer-a11y on `ui`.
  - reviewer-ui on `ui` when a reference exists (the current design, or RECON's `ui_reference`). Without one it folds into reviewer-ux.
  - `ui_free` drops the tag-derived UI reviewers.
  - Intake overrides apply last, to every slice: `remove` drops the role; `add` adds it, except that reviewer-ui with no reference adds reviewer-ux instead.
- **Reviewers.** Four new sonnet agents, all under the reviewer-code charter and output protocol:
  - reviewer-security reviews the diff.
  - reviewer-ux, reviewer-a11y and reviewer-ui judge the running app. Each of their findings must carry `observed:`, and a11y reports objective failures only.
- **Build round (still one slice at a time).**
  - The order is builder → CLI commit → contract.test. Then the round's diff reviewers, plus `contract.health` (dev server restarted at the slice head) when a running-app reviewer is due. The running-app reviewers follow once health passes.
  - Round 1, and the first round after a slice rework, reviews with the full roster. After FINDINGS, only the reviewers that raised findings re-check (AD-30). A failing health check counts as a failed round, like a failing test.
  - A slice closes when every rostered role's latest verdict is APPROVE, plus today's test, sha and git.deps rules.
- **Browser driver (decided 2026-10-25: Playwright MCP).** Running-app reviewers use the run contract's `e2e` when it names one. Otherwise they use Playwright MCP, against the run's single dev server.
  - The plugin's `.mcp.json` declares one pinned `@playwright/mcp --isolated` server per running-app role (`playwright-ux`, `playwright-a11y`, `playwright-ui`).
  - Each reviewer's `tools:` lists only its own server, so every reviewer gets its own isolated context.
  - **Before any wiring,** an isolation check reruns spike 04's criterion against these servers: three parallel sessions on one dev server, no shared cookie or localStorage, separate snapshot refs. It also confirms that a plugin subagent can call its server's tools. The verdict goes in `spike-results.md`. **A fail halts the build** and comes back to the human.

## Boundaries & Constraints

**Always:**
- `schedule`, `roster`, `cards`, `artifacts`, `verify` and `reducer` stay pure.
- Events stay additive within `v:1`, and the fixture `*.state.json` shasums stay unchanged. The reducer stores a slice's `tags` and `roster` only when the event carries them.
- The board gets the new data from command data only (AD-23). Cards come only from `core/cards.ts`.
- A slice whose roster is `[reviewer-code]` runs exactly today's step sequence.
- Agents never start or stop servers. Running-app reviewers are issued only while no builder step is claimed.

**Never:**
- Pipelining, time-box escalation, `step_cancelled` or reissue caps: those are 3-4.
- `rerun SLICE_PLAN`: it stays in `LATER`.
- Slice tags re-triggering the designer.
- New npm dependencies in the project, or regenerated `test/fixtures`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Slicer due | Gate 1 passed | `next` issues spawn slicer (stage SLICE_PLAN) | — |
| Plan reported | Valid `slices` | step_verified → plan.lint → gate_2 rows such as `S1 Signup form (AC-1, AC-2) [ui, input] · code, security, ux, a11y, ui; S2 Welcome mail (AC-3) ← S1 · code` | Schema error (not a JSON list, unknown tag, bad field type) → `MISSING_EVIDENCE` and a reissue. Lint error (bad or duplicate id, unknown or uncovered AC, `depends_on` not an earlier slice) → plan.lint fails, and the card shows the errors with rework only |
| No reference | `ui` tag, no design, no `ui_reference` | Roster: code, ux, a11y | — |
| Overrides | remove security, add a11y | No slice has security; every slice has a11y | — |
| UI-free | `ui_free: true`, slice tagged `ui` | No ux, a11y or ui unless an override adds them | — |
| Round with app reviewers | Test passed; roster has ux | code, security and contract.health are issued together; ux, a11y and ui follow once health passes | Health fails → a builder round citing the health log; at the cap → Non-convergence |
| Partial findings | security FINDINGS, the others APPROVE | Builder round, then only security re-checks. The slice closes once security approves | At `MAX_RETRIGGER_ROUNDS` the Non-convergence card names each reviewer still at FINDINGS |
| Missing observed | A ux, a11y or ui finding without `observed:` | `MISSING_EVIDENCE` and a reissue | — |
| Gate-2 rework | `/factory rework gate2 <note>` | The slicer step, its `step_verified` and plan.lint are voided. A new slicer (attempt+1) gets the note and the previous plan | — |

</frozen-after-approval>

## Code Map

- `src/core/events.ts:54` `SlicePlanEntry`: add `tags?` and `roster?`. Keep the internal name `deps`; the slicer's `depends_on` maps onto it.
- `src/core/reducer.ts`: `Slice` (:33) and the gate_2_passed fold (:295) copy `tags` and `roster` only when present (fixture shasums). The `FINDINGS_QUEUED` transition (:221) already fires on any `reviewer-*`.
- `src/core/roster.ts` (new): `SLICE_TAGS`, `DIFF_REVIEWERS`, `APP_REVIEWERS`, `rosterOf(tags, {intake, hasReference})`. Overrides use `OVERRIDE_ROLES` (`artifacts.ts:55`).
- `src/core/artifacts.ts`:
  - Add `validateSlicePlan` as `SCHEMA.slicer`. Front matter is the flat parser, so `slices` is single-line JSON.
  - `planLint` (:268) also checks that tags are in `SLICE_TAGS`.
  - `checkOutput` requires `observed` on findings from `APP_REVIEWERS`.
  - Drop `deriveSinglePlan` (:262).
- `src/cli/check.ts:88` `currentPlan`: build the plan from the latest verified, unvoided slicer front matter, with the roster per slice. The reference is `latestDesign(state)` or `state.recon.context.ui_reference`. The digest stays the same. `healthCheck` (:62) restarts the server for stage `BUILD` too.
- `src/core/schedule.ts`:
  - `slicePlan()` (:122) gets the slicer spawn and respawn, following `spec()` (:88). plan.lint runs only after the verified slicer.
  - `build()` (:137) replaces the single reviewer-code with the round's due reviewers and health.
  - The merge view (:169) gets one verdict per rostered role.
- `src/core/verify.ts`:
  - `roundOf` (:192) returns `health`, `healthCheck` and `reviewers` keyed by role.
  - Add `dueReviewers(s, slice)`. It returns the full roster when no reviewer has run since `slice_started` or the slice's latest rework; otherwise the roles whose latest verdict is FINDINGS.
  - `roundFailure` (:204) gets kind `health`, and collects the findings of every FINDINGS reviewer.
  - `closeEvidence` (:213) requires every rostered role's latest verdict to be APPROVE.
  - `reworkVoids('gate2')` (:129) adds the slicer step and its `step_verified`.
- `src/core/cards.ts`: `gate2Card` (:77) rows; `nonConvergenceCard` `why`; `mergeCard` (:166) rows with the verdict per role.
- `src/cli/next.ts:218`: the Non-convergence `why` names the reviewers.
- `src/cli/decide.ts:193`: the merge pins every rostered reviewer's latest verified output.
- `src/cli/brief.ts`:
  - `FORMAT` gets slicer and the four reviewers. The app roles' format has `observed: <url> <state> [<screenshot>]`.
  - `SLICE_ROLES` (:106) gets every reviewer.
  - The slicer's inputs are context, spec and design, plus the previous voided plan; its notes are the gate-2 rework notes.
  - Facts:
    - diff reviewers get the diff;
    - app reviewers get the contract `url`, `e2e`, and the session `<run-id>-<role>`;
    - reviewer-ui gets its reference path.
  - `previousRound` (:110) merges every raising reviewer's findings and their paths.
- `agents/slicer.md` (opus; Read, Grep, Glob, Write), `agents/reviewer-{security,ux,a11y,ui}.md` (sonnet): mirror `reviewer-code.md`. The app reviewers get Read, Grep, Glob and Write plus only their own `mcp__plugin_d2t-factory_playwright-<role>__*` tools. Confirm the exact names in the isolation check.
- `src/core/projection.ts:275` and `src/dashboard/web/src/lib/types.ts`: the slice card gets `tags` and `roster`. `ClaimList.svelte`/`SliceCard.svelte:20` show one pending row per rostered reviewer that has no claim yet. Names and sprites already exist (`model.ts:186`).
- Tests: add `slicerOut()` to `test/harness.ts`, and route every flow that passes gate 2 through the slicer.

## Tasks & Acceptance

**Execution:**
- [x] `.mcp.json` + `spikes/08-playwright-isolation/` -- the per-role pinned servers and the isolation check; record the verdict in `spike-results.md`. HALT on fail.
- [x] `src/core/{roster,events,reducer,artifacts,cards,verify,schedule}.ts` -- roster, slicer schema, plan lint, round and close logic per the Code Map.
- [x] `src/cli/{check,brief,next,decide}.ts` -- plan from the slicer, BUILD health restart, briefs, Non-convergence text, merge pins.
- [x] `agents/{slicer,reviewer-security,reviewer-ux,reviewer-a11y,reviewer-ui}.md` -- roles, charter, driver usage.
- [x] `src/core/projection.ts` + web `types.ts`/`ClaimList.svelte`/`SliceCard.svelte` -- tags and pending roster rows.
- [x] `test/{roster,artifacts,cards,schedule,verify,reducer,projection,pipeline}.test.ts` + `test/harness.ts` -- every matrix row; migrate the gate-2 flows.

**Acceptance Criteria:**
- Given a brownfield run through `bin/factory` with a design and no overrides, when the slicer plans S1 `[ui, input]` and S2 (`depends_on: [S1]`, no tags), then:
  - the gate_2 card shows both rosters, and `gate_2_passed.slices` carries tags, deps and roster;
  - S1's round issues code, security and health, then ux, a11y and ui;
  - S2's round issues reviewer-code only;
  - every command passes `validateEvent`.
- Given a slice roster `[reviewer-code]`, when it builds, then the step sequence equals today's.
- Given the plugin installed, when the isolation check runs three app reviewers in parallel, then each sees only its own cookie and localStorage, and each acts by its own snapshot's refs.
- Given the repo, when Verification runs, then all tests pass, tsc reports 0 errors, and the fixture shasums are unchanged.

## Implementation Notes

- **Isolation check: PASS** (`spike-results.md` § 08, run 2026-10-25, `@playwright/mcp@0.0.83`). Two setup misses came first:
  - Claude Code dedups plugin MCP servers with identical command and args, so only `playwright-ux` connected. Each server now adds its own `--output-dir ${HOME}/.factory/playwright/<role>`, which is also where its screenshots go. These args must stay distinct.
  - A session whose cwd is under a directory with the same `.mcp.json` loads it as a project server and shadows the plugin's servers.
  - Tool names are `mcp__plugin_d2t-factory_playwright-<role>__browser_*`. The `__*` wildcard in `tools:` works and grants only that server.
- **`dueReviewers` is broader than the Code Map's wording.** It returns:
  - the full roster when no reviewer ran since `slice_started` or the latest rework, and also when every rostered role's latest verdict is APPROVE (a builder round that no finding asked for, such as a New dependency retry). Otherwise that round would close without any review, which today's reviewer-code flow never does;
  - otherwise the FINDINGS roles, plus any rostered role that has not run yet (one a failing health check kept out).
- **The rework boundary is derived, not stored.** `reviewSince` is the newest WRAP step's `issued_seq`. A slice rework is only decided at the merge card (WRAP), so this needs no new reducer field and the fixture shasums stay the same.
- **A round's due set is fixed at its test** (`roundOf(...).due`). Each due role runs at most once per round. The diff reviewers and health are issued together. The app reviewers follow once health passed, even when a diff reviewer already reported FINDINGS: findings are batched into one builder round. The builder round, or Non-convergence, waits until nothing of the round is open.
- **Gate 2 also pins the slicer's out.md** next to the spec.
- **App reviewers have no Bash** (per the Code Map's tool list), so they cannot run the contract's `e2e` themselves. Their brief names the e2e tooling and tells them to read its tests and follow those flows, while driving the app with their own Playwright server.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-25): blind-hunter (B), edge-case-hunter (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B3/E3/V-o1 | The `__*` wildcard grants `browser_run_code_unsafe` and `browser_file_upload`, which run code or read files in the MCP server process, outside the sandbox. Only the prompt forbids them | medium | The spike's init tool list includes both. Text injected into a reviewed page could lead the reviewer to call them | patch: an explicit `tools:` list without those two tools, in the agents and the brief fact |
| B6/E1/E9 | A role's MCP server, and its browser context, is reused by every later spawn of that role. The brief's `session <run-id>-<role>` isn't enforced | medium | One server per role per conductor session (`.mcp.json`); `--isolated` keeps its context until `browser_close` | patch: app reviewers call `browser_close` first; the brief fact says so instead of naming a fake session |
| B5/E2 | Screenshots go to a fixed per-role folder with fixed example names, so a later review overwrites the image an earlier `observed:` cites | medium | `--output-dir ${HOME}/.factory/playwright/<role>` is shared across runs and rounds; the examples use `empty-submit.png` | patch: screenshots are named `<step_id>-<n>.png` (agents and the brief) |
| B9 | reviewer-ux is never told that reviewer-ui reviews the slice, so it duplicates the rendering checks | low | Only reviewer-ui's brief gets the reference fact; `reviewer-ux.md` says rendering is "yours alone" when no reference is named | patch: ux's brief says whether reviewer-ui is on the slice; agent wording follows |
| B7 | Parallel app reviewers share one backend, so one reviewer's data can cause another's false finding | low | A single dev server per run (AD-20); nothing warns the reviewers | patch: one sentence in the app agents about using role-unique test data |
| E5 | `contract.health` restarts the dev server while diff reviewers may be running tests | low | Health and the diff reviewers are issued together (frozen Approach); `reviewer-security.md` allows running the tests | patch: the diff reviewer format says the server may restart, so don't rely on it |
| B10 | Spike 08 barrier: a timeout and a later release both end the response, throwing `ERR_HTTP_HEADERS_SENT` | low | `run.ts` `devServer` leaves the timed-out waiter in `waiting[step]` | patch: guard with `res.writableEnded` |
| V1 | The BUILD restart before `contract.health` is unverified | medium (pre-verified) | Only WRAP asserts a pid change; reverting `check.ts:121` keeps the suite green | patch: assert the pid change in the 3-3 acceptance test |
| V2 | A Non-convergence card caused by a failing check (health) at the cap is never reached at the CLI | medium (pre-verified) | Cap tests reach it only with findings; `roundWhy` is unit-tested only | patch: a pipeline test with health failing at the cap, asserting `contract.health still fails` |
| V3 | The `e2e` fact in app reviewer briefs is untested | medium (pre-verified) | `e2e` appears only in the contract shape test | patch: a brief assertion with and without `e2e` |
| V4 | The slicer's design input is never asserted | medium (pre-verified) | No design-bearing flow reads the slicer brief | patch: assert it in `toGate2Design` |
| V5 | `.mcp.json` keys, distinct args and agent `tools:` lines are not checked by the suite | medium (pre-verified) | No test reads `.mcp.json` or `agents/*.md` | patch: a config-consistency test |
| V6 | SliceCard's rule that hides `reviewing` while pending rows show is untested | low (pre-verified) | The derivation is inline in the `.svelte` file; there are no component tests | defer |
| E10 | App reviewers never run the run contract's `e2e`: with no Bash they only read its tests and drive Playwright MCP | low | Frozen intent: "use the run contract's `e2e` when it names one". The Code Map gave app reviewers no Bash, and Bash would hit the spike-04 sandbox failure again. The review still judges the running app | reject (surfaced to the human at step 5) |
| B1 | After FINDINGS only the raising reviewers re-check, so other roles' APPROVE covers an older commit, and health doesn't rerun when only a diff reviewer is due | false | This is the frozen intent ("only the reviewers that raised findings re-check (AD-30)"); contract.test runs after every commit | reject |
| B2 | The `claimed` builder filter in `build()` is dead code | low | It can't fire with one slice at a time; harmless, and it encodes the AD-30 rule 3-4 pipelining needs | reject |
| B4 | reviewer-security's Bash is read-only by instruction only | low | Same as the existing `reviewer-code.md`, which the spec said to mirror | reject |
| B8 | The brief and the agents disagree on whether a screenshot is required; the validator doesn't check for a URL | low | AD-11's `[<screenshot>]` is optional; the frozen intent requires only `observed:` | reject |
| B11 | Spike 08 always exits 0 | false | Every spike runner ends `await main(); process.exit(0);`; the verdict goes in `verdict.json` | reject |
| B12 | Pending rows ignore the round's due set and hide `reviewing`; tags aren't shown | low | Non-raising roles keep live (unvoided) claims, so they don't show as pending; tags reach the card data as the Code Map asks | reject |
| B13 | A slicer ESCALATE becomes a plan.lint failure | false | `steps.ts:110` raises the escalation; an ESCALATE step is never verified, so `slicePlan()` waits | reject |
| B14a | Merge pins silently skip a rostered reviewer with no verified step | low | Same as the existing reviewer-code pin; reachable only through Non-convergence `accept` | reject |
| B14b | planLint doesn't enforce S1, S2, … order | low | Same as before 3-3; build order is `slice_order` either way | reject |
| B14c | An empty failed plan's card text has a double space | low | Cosmetic, and only on an empty plan | reject |
| B14d | `uiReference` can return `"undefined"` | false | Every agent step has `output_path` (`next.ts` `issueDue`) | reject |
| B14e | `validateEvent` doesn't type-check `tags` or `roster` | low | Only the CLI writes them, from `rosterOf`; `slices: 'array'` as before | reject |
| E4/E8 | Intake `remove reviewer-ux` plus `add reviewer-ui` with no reference brings ux back | low | Contradictory overrides; the frozen fold rule ("adds reviewer-ux instead") gives the human the UI reviewer they asked for | reject |
| E6 | A run parked at gate 2 from before 3-3 gets a second gate_2 card | low | Needs a run left at gate 2 across the upgrade (same as 3-2's B3); approving the stale card is refused on the plan digest | reject |
| E7 | Gate-2 rework notes no longer reach the builder through the slice notes | low | By design: the slicer applies the note (frozen gate-2 rework row) | reject |
| V-o2 | The `[reviewer-code]` equivalence test compares the new code with itself | low | The AC is still covered by the existing 1-5 BUILD schedule tests, which assert exact `due()` outputs | reject |

## Design Notes

- **Why only the raising reviewer re-checks.** AD-30 says so, and it keeps a round at about 5 min instead of rerunning five reviewers. The test check after every builder commit guards against regressions.
- **Why health goes alongside the diff reviewers.** It restarts the server only when an app reviewer is due, so a diff-only slice pays nothing.
- **Slicer out.md example:**

```
STATUS: DONE
---
slices: [{"id": "S1", "title": "Signup form", "acs": ["AC-1", "AC-2"], "tags": ["ui", "input"], "depends_on": []}, {"id": "S2", "title": "Welcome mail", "acs": ["AC-3"], "tags": [], "depends_on": ["S1"]}]
---
S2 sends the mail S1's form triggers.
```

## Verification

**Commands:**
- `node --test test/` -- expected: all pass (port-binding tests need to run outside the sandbox).
- `npm i --prefix "$TMPDIR/tsc" --cache "$TMPDIR/npm-cache" typescript@7.0.2 @types/node@22 && "$TMPDIR/tsc/node_modules/.bin/tsc" -p tsconfig.json --typeRoots "$TMPDIR/tsc/node_modules/@types"` -- expected: exit 0.
- `shasum test/fixtures/*.state.json` before and after -- expected: identical.
