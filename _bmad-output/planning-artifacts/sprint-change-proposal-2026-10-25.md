---
title: 'Sprint change proposal: dry run 1 findings 2, 3, 4, 5, 6b, 8, 9'
date: '2026-10-25'
status: 'approved'
approved: '2026-10-25'
mode: 'batch'
trigger: '_bmad-output/implementation-artifacts/dry-run-findings.md'
scope: 'moderate'
---

# Sprint Change Proposal — dry run 1, findings 2, 3, 4, 5, 6b, 8, 9

## 1. Issue summary

Dry run 1 (2026-10-25, brownfield, `maciekt07/TodoApp`, stopped in BUILD at S2 of 5) was the first end-to-end run of the plugin on an unseen repo. Findings 1, 6a, 7, 10, 11 and 12 are fixed (`spec-dry-run-1-fixes.md`, commit `6eadec3`). This proposal covers the seven findings that need a decision before code changes:

| # | Kind | Problem, in one line | Root cause in the contract |
|---|---|---|---|
| 2 | product | The time limit is mandatory and worded as "the whole exercise", so the factory advertises an interview setting. | SPEC CAP-2 and CAP-11 assume a stated limit. AD-27 makes `limit_min` required. |
| 3 | UX | Cards don't say what to type next, what happens after it, or what a chat reply does. | AD-34's card is `{title, reason, commands}`. Nothing carries "what next". |
| 4 | UX | The intake confirm card shows four fields, not the task and scope the human agreed. | AD-34 lists exactly those four fields, and the AD-27 intake schema has no task or scope fields. |
| 5 | dashboard | A claim waiting on the human or on checks turns red `UNVERIFIED · no hook fact` after 30 s. | AD-7's overlay has no "waiting on something else" state. The CLI already exempts those steps (`next.ts:470`), but the dashboard doesn't. Two definitions of "overdue", which AD-7 forbids. |
| 6b | design | Every SCAFFOLD failure pages the human, even one the factory could fix itself (Puppeteer's half-downloaded browser cache). | CAP-4 and the closed ask list have no repair step. The scaffolder is told "the human decides". |
| 8 | dashboard | The human approves the spec, `design.md` and the slice plan but can't read them on the board, only their paths as plain text. | AD-23: "The dashboard never reads `artifacts/`". The artifact text isn't in event data. |
| 9 | **bug** | After a rejected tool call the Stop hook blocked 9 times until Claude Code forced the turn to end. | AD-12 blocks "whatever `stop_hook_active` says" and relies on Claude Code's cap (8 continuations) as a silent backstop. Nothing tells a human rejection apart from the conductor quitting. |

Evidence is in `dry-run-findings.md`, rows 2–9. The run's state was deleted, so the code references below come from reading the current source.

## 2. Impact analysis

### Epics and stories

All 14 planned stories (0-1 … 5-2) are built. No story is invalidated. Every change here amends behaviour that a done story shipped:

| Finding | Stories it amends |
|---|---|
| 2 | 3-1 (intake, budget clock, cut gate), 2-2 (Budget clock UI) |
| 3, 4 | 3-1 (intake card), 1-4 / 3-3 (gate cards), 1-5 (merge card), 3-4 (escalation cards), 2-2 (Needs You card) |
| 5 | 2-1 (projection), 2-2 (Claim chip, drawer) |
| 6b | 1-4 (SCAFFOLD), 5-2 (greenfield SCAFFOLD), 3-4 (closed ask list) |
| 8 | 2-1 (projection), 2-2 (Evidence drawer), 1-4 / 3-2 / 3-3 (the steps whose output is pinned) |
| 9 | 1-3 (Stop hook) |

**Proposed:** a new epic 6, *Dry run 1 product changes*, with four independent stories (section 4.7). Finding 9 goes first because it blocks dry run 2. Dry run 2 then covers what dry run 1 never reached: WRAP, merge, recording and replay, the cut card, and Runs B and C.

### Artifact conflicts

| Artifact | Sections affected |
|---|---|
| `SPEC.md` | Constraints (time limit), CAP-2, CAP-4, CAP-11, CAP-14, CAP-15 |
| `review-policy.md` | The closed ask list (SCAFFOLD failure row and its footer) |
| `truth-layer.md` | Principle (claim states), Semantics (Stop rule), Dashboard (artifact view) |
| `pipeline-stages.md` | INTAKE and SCAFFOLD rows, the Budget clock paragraph |
| `ARCHITECTURE-SPINE.md` | AD-7, AD-12, AD-17, AD-21, AD-23, AD-27, AD-34, Open Questions (Stop and nudge) |
| `EXPERIENCE.md` | Chat surfaces, Claim truth, Budget clock, Gates/budget states, Evidence drawer variants, Interaction Primitives, Open items |
| `DESIGN.md` | Budget clock, Claim chip, Action slot, Evidence drawer |

### Technical impact

No new process, route, dependency or write path. Every change is additive within event schema `v:1` (AD-32): new optional fields on `Card`, the intake output, `step_verified.data`, and two new fact kinds. Old recordings fold unchanged. Their cards have no `options`, so the board shows `commands` as it does today.

## 3. Recommended approach

**Direct adjustment** (checklist option 1): amend the contract, then four small stories. Rollback (option 2) buys nothing, since the shipped code is sound and only incomplete. An MVP review (option 3) isn't needed: none of the findings threatens the success signal. They block it being *seen* (5, 8) or *reached* (9).

- **Effort:** medium overall. 6-1 low, 6-2 medium, 6-3 medium, 6-4 medium.
- **Risk:** low. The riskiest change is 6-1 (Stop), because it touches CAP-14's guarantee. The design below makes that guarantee narrower but *honest*: today it already ends at Claude Code's cap, silently.
- **Timeline:** about one dev session per story, then dry run 2.

## 4. Detailed change proposals

Each subsection answers the question you posed, then gives the edits.

### 4.1 Finding 2 — the time limit is optional and neutrally worded

**Decision.** `limit_min` becomes optional. With no limit:

- **No budget clock and no cut gate.** `budgetOf` returns null, so no cut is ever raised (CAP-11 applies only with a limit). The slice time box (escalation condition 3) still bounds each slice, so a run without a limit still can't drift silently.
- **The swimlane header slot shows elapsed time** in the same 236 px slot: `ELAPSED 0:47 · no limit`. There's no meter and no cut marker. It counts up from the clock start and stops when the run ends.
- `started` is only asked about, and only accepted, alongside a limit ("did that clock start before this run?").

**Wording.** No surface says "exercise" or "interview". The run has "a time limit", which the human sets or leaves out. The places it shows:

| Surface | Old | New |
|---|---|---|
| Intake brief, `src/cli/brief.ts:322` | `limit_min`: the time limit for the whole exercise, in minutes (2:00 is 120). | `limit_min` (optional): ask whether this task has a time limit, in minutes (2:00 is 120). Leave it out when there is none: then there is no budget clock and no cut. |
| Intake brief, `:323` | `started`: when the exercise started, if before this run… | `started` (only with a limit): when that time limit's clock started, if before this run… |
| Intake brief, `:332` | Add a `started` line only when the exercise began before this run. | Add a `started` line only when the limit's clock started before this run. |
| Intake chat card, `cards.ts:15` | Ask for the time limit, the slice time box… | Ask whether there is a time limit (optional), the slice time box… |
| Intake confirm card | `limit 2:00` | `time limit 2:00` or `no time limit` |
| Dashboard | `BUDGET 1:12 left of 2:00` | unchanged with a limit; `ELAPSED 0:47 · no limit` without one |

**Edits:**

```
SPEC.md — CAP-2 intent
OLD: …the human enters the exercise's stated time limit and may set the slice time box…
NEW: …the human may set a time limit for the run and may set the slice time box…

SPEC.md — CAP-2 success
OLD: …slice box defaults to 30 min when not given; …
NEW: …slice box defaults to 30 min when not given; no time limit when none is given; …

SPEC.md — CAP-11 intent
OLD: A budget clock, running from run start and never pausing, makes the conductor propose cutting
     remaining slices at the stated time limit − 40 min, as a live human gate.
NEW: When INTAKE set a time limit, a budget clock, running from run start and never pausing, makes
     the conductor propose cutting remaining slices at the limit − 40 min, as a live human gate.
     Without a limit there is no budget clock and no cut gate; the board shows elapsed time.

SPEC.md — CAP-11 success (append)
NEW: A run with no time limit never raises a cut and its lane shows elapsed time.

SPEC.md — Constraints, first bullet
OLD: Brief → working, human-approved result within the exercise's stated time limit…
NEW: Brief → working, human-approved result within the time limit when one is set…

pipeline-stages.md — INTAKE row
OLD: records the exercise's stated time limit (and its start, if earlier than the run's)
NEW: records an optional time limit (and when its clock started, if earlier than the run)

pipeline-stages.md — Budget clock paragraph (prepend)
NEW: Only when INTAKE set a time limit; without one there is no clock, no cut, and the board shows elapsed time.
OLD: Budget clock: runs from run start (or the earlier exercise start entered at INTAKE)…
NEW: Budget clock: runs from run start (or the earlier start entered at INTAKE with the limit)…

ARCHITECTURE-SPINE.md — AD-27 intake schema
OLD: intake: limit_min, slice_timebox_min?, ui_free, reviewer_overrides, started?
NEW: intake: task, scope{in[], out[]}, limit_min?, slice_timebox_min?, ui_free, reviewer_overrides,
     started? (only with limit_min)        ← task/scope: see 4.2

ARCHITECTURE-SPINE.md — AD-17, budget clock bullet
OLD: The budget clock runs from run_started.ts, or from the intake's started if that is earlier. It never pauses.
NEW: The clock runs from run_started.ts, or from the intake's started if that is earlier. It never pauses.
     With limit_min it is the budget clock (cut_at, ends_at); without it the projection carries only
     clock_start and the board shows elapsed time. No cut is ever raised without a limit.

EXPERIENCE.md — Component Patterns, Budget clock
OLD: Counts down from the stated limit; bar drains leftward; cut marker fixed at limit − 40m (CAP-11).
NEW: With a time limit: counts down from it; bar drains leftward; cut marker fixed at limit − 40m
     (CAP-11). Without one: `ELAPSED m:ss · no limit`, counting up; no bar, no cut marker.

DESIGN.md — Board, Budget clock (append)
NEW: No-limit variant: same 236px slot, clock glyph + `ELAPSED` + `0:47` (readout) + `· no limit`
     in text-3; no meter, no caption.

EXPERIENCE.md — Voice and Tone, Do/Don't (add row)
NEW: | `time limit 2:00`, `no time limit` | "exercise", "interview" or any wording that implies who the run is for |
```

**Code:** `artifacts.ts` (`limit_min` optional, `started` requires it), `budget.ts` (`budgetOf` null without a limit, a separate `clockView`), `projection.ts` (`budget` becomes `{clock_start, limit_min|null, …}`), `BudgetClock.svelte` and `model.ts` (the elapsed variant), `brief.ts`, `cards.ts`. Tests: intake validation with no limit, no cut candidates without a limit, and the projection.

### 4.2 Findings 3 + 4 — every card says what to type, what happens next, and what a chat reply does

**Decision.** AD-34 adds two optional fields to the card, single-sourced in `cards.ts` like the others:

- `options: {command, then}[]` gives each legal command with one line on what happens after it. `commands` stays, derived from `options`, so old readers and recordings keep working.
- `reply` is one line on what a chat reply does at this card.
- `details: string[]` holds extra lines shown between the reason and the options. The intake card uses it for task and scope.

The conductor prints, and the Needs You card renders, in this order: the title, the reason, the details, `To continue, type one of:`, then each `command — then`, then the `reply` line.

**One thing to confirm: what a chat reply does.** It can truthfully "change the answer" only at INTAKE, where the conversation *is* the input and the conductor rewrites the intake. At every gate and escalation, AD-6 says a decision counts only when typed as `/factory …`. A chat reply there gets an answer but changes nothing, and a change goes through `rework` or `rule … retry <note>`. Making chat change a gate would mean turning free text into a decision, which reopens AD-6. So I propose a `reply` line that's true for each card, not one shared line:

| Card | Options and `then` (examples) | `reply` |
|---|---|---|
| Intake confirm | `/factory approve intake` — RECON maps the repo (FRAME picks the stack), then SCAFFOLD; the next stop is Gate 1 | Reply in chat to change any of this; you'll get this card again. |
| Gate 1 | `approve gate1` — SLICE PLAN splits the spec into slices; the next stop is Gate 2 · `rework gate1 <note…>` — SPEC (and DESIGN) are redone with your note; Gate 1 comes back | Ask questions in chat; to change the spec or design, use rework. |
| Gate 2 | `approve gate2` — BUILD starts with the first slice; the next stop is the merge, unless an escalation or the cut point comes first · `rework gate2 <note…>` — the plan is redone with your note; Gate 2 comes back | as Gate 1 |
| Merge | `merge` — the CLI merges `<branch>` into `<target>` locally and the run ends · `rework S<n> <note…>` — S<n> goes back to its builder and reviewers; this card comes back · `abandon` — the run ends; nothing is merged | as Gate 1 |
| Cut | `cut S4,S5` — those slices are not built; BUILD goes on with the rest · `keep` — every slice is built; no cut is proposed again | — |
| Escalation | `rule E<n> retry <note…>` — the agent gets your note and tries again · `accept` (where legal) — said per card · `abandon` | Ask in chat; to decide, type one of the commands. |
| SCAFFOLD failure | `retry <note…>` — the scaffolder runs again with your note, then the checks · `accept` — SCAFFOLD is accepted as is and SPEC starts · `abandon` | as Escalation |
| Design question | `choose a\|b` — `design.md` is written for that option, then Gate 1 | as Escalation |

**Intake confirm card (finding 4).** The intake output gains `task` (one line, required) and `scope` (`in` and `out` lists, either may be empty), set in front matter so the card never parses prose. They're covered by the `sha256` that `intake_confirmed` already pins (AD-10). The card shows:

```
Intake — confirm the task
time limit 2:00 · slice time box 30 min · UI-free no · reviewers: default
Task: add an optional task giver to each todo
In scope: a giver field on add and edit; shown on the todo card
Out of scope: filtering or sorting by giver
To continue, type one of:
  /factory approve intake — RECON maps the repo, then SCAFFOLD; the next stop is Gate 1
Reply in chat to change any of this; you'll get this card again.
```

**Edits:**

```
ARCHITECTURE-SPINE.md — AD-34, The function
OLD: card = {type, title, reason_label?, reason?, commands[]}
NEW: card = {type, title, reason_label?, reason?, details?[], options?[{command, then}], reply?, commands[]}
     — commands[] = options.map(command) when options is present. Each `then` says what happens next
     if that command is typed; `reply` says what a chat reply does at this card, truthfully: at the
     intake card it changes the intake; elsewhere it changes nothing (AD-6).
OLD: The intake card shows limit_min, slice_timebox_min, ui_free and reviewer_overrides from the intake output.
NEW: The intake card shows task and scope as details, then limit_min (or "no time limit"),
     slice_timebox_min, ui_free and reviewer_overrides.

ARCHITECTURE-SPINE.md — AD-34, The conductor
OLD: prints it verbatim as the last lines of any turn that ends on ask_human.
NEW: prints it verbatim as the last lines of any turn that ends on ask_human, in the order title,
     reason, details, "To continue, type one of:", each `command — then`, reply.

review-policy.md — closed list, last paragraph
OLD: Chat and dashboard show each ask with the same title, reason, and commands.
NEW: Chat and dashboard show each ask with the same title, reason, commands, what each command does
     next, and what a chat reply does.

EXPERIENCE.md — Chat surfaces, Gate / escalation message
OLD: Shape (lines separated by /): `[GATE] Gate 1 — Spec + Design ready` / reason or checks / `/factory resume r-2c91`.
NEW: Shape: `[GATE] Gate 1 — Spec + Design ready` / reason / details / `To continue, type one of:` /
     one `<command> — <then>` line per option / the reply line.

EXPERIENCE.md — Component Patterns, Action slot
OLD: Shows the exact command + Copy button.
NEW: Shows each command + Copy button, with its `then` line below it, and the card's reply line once
     at the bottom.

DESIGN.md — Action slot (append)
NEW: Each command row is followed by its `then` line in body-sm, needs-text-3; the reply line closes
     the slot in body-sm, text-3. With several commands, the rows stack inside one slot.

skills/factory/SKILL.md (ask_human, any other)
OLD: print … the title, then the reason, then each of the commands on its own line, exactly as given.
NEW: print … in the card's order (AD-34), exactly as given.
```

**Code:** `events.ts` (`Card`), `cards.ts` (every card function), `artifacts.ts` (`task` and `scope` in the intake), `brief.ts` (the intake format), `skills/factory/SKILL.md`, and `NeedsYouCard.svelte` / `ActionSlot` (render options, fall back to commands). Tests: one per card that `options` and `commands` agree.

### 4.3 Finding 5 — claim states that keep UNVERIFIED meaning one thing

**Decision.** UNVERIFIED keeps exactly one meaning: *the agent claimed it, and the hook facts that would confirm it never arrived.* A reported step that is *waiting on something else* is still CLAIMED and never gets an overdue clock. Core works out what it waits on, and the CLI and the dashboard both read that one answer, so the duplicate rule in `next.ts:470` goes away.

`claimOverlay` returns `waiting_on: 'human' | 'checks' | null`:

| Overlay | When | Chip | Drawer proof row | Overdue? |
|---|---|---|---|---|
| CLAIMED · waiting on human | Reported, and its verification needs a human decision not yet made: an `ask_human` step (the intake), or the subject of an open ask (a scaffolder whose checks failed, a builder's escalation) | `CLAIMED · awaiting Master d2t` | `waiting on Master d2t — <card title>` | never |
| CLAIMED · waiting on checks | Reported, and the run_check steps its verification needs are issued but not yet verified (SCAFFOLD's install, health and test) | `CLAIMED · checks running` | `waiting on <check names>` | never |
| CLAIMED | Reported, waiting only on hook facts, and younger than `CLAIM_OVERDUE_MS` | `CLAIMED` | `none yet` | from `step_reported` |
| VERIFIED | `step_verified`, not voided | `VERIFIED` | the evidence | — |
| UNVERIFIED | Reported, waiting only on hook facts, and older than `CLAIM_OVERDUE_MS` | `UNVERIFIED · no hook fact` | `no hook fact` | — |

When a wait ends (the human decides, or the checks finish), the step either verifies or a card opens, so there's no gap in which it can turn red. The truth legend keeps its three entries. "Awaiting" is a gloss on CLAIMED, not a fourth state, so no new color or token is needed.

**Edits:**

```
ARCHITECTURE-SPINE.md — AD-7, Overlay states
OLD: - reported: evidence is pending, and it is younger than CLAIM_OVERDUE_MS since step_reported.
     - verified.
     - unverified.
NEW: - reported: evidence is pending. `waiting_on` says on what: `human` (an ask_human step, or the
       subject of an open ask), `checks` (its run_check steps are issued and not verified), or null
       (only hook facts). Only a null wait has an overdue_at.
     - verified.
     - unverified: waiting_on is null, and CLAIM_OVERDUE_MS has passed since step_reported. It means
       only "claimed, and the hooks never confirmed it".
     The CLI's overdue reissue (AD-24) and the board both use this one overlay.

truth-layer.md — Principle (append)
NEW: A claim waiting on a human decision or on the CLI's checks is shown as claimed, with what it
     waits on; only a claim whose hook facts never arrived is unverified.

SPEC.md — CAP-15 success
OLD: A claim with no matching hook fact displays as unverified; …
NEW: A claim whose hook facts never arrived displays as unverified; one waiting on a human decision or
     on checks displays as claimed with what it waits on; …

EXPERIENCE.md — State Patterns, Claim truth
OLD: | CLAIMED | Claim chip | Agent reported it; no hook fact or evidence check yet. …
NEW: | CLAIMED | Claim chip | Agent reported it; no hook fact or evidence check yet. Gloss
     `· awaiting Master d2t` while a human decision is pending on it, `· checks running` while its
     checks run; neither ever turns UNVERIFIED. …
OLD: | UNVERIFIED | … Claim overdue with no hook fact (CAP-15). …
NEW: | UNVERIFIED | … Claimed, waiting on nothing but hook facts, and overdue with none (CAP-15). …

EXPERIENCE.md — Open items, "Claim overdue window"
NEW status: Kept at 30 s; it now applies only to claims waiting on hook facts (dry run 1).

DESIGN.md — Claim chip (append)
NEW: The waiting glosses (`· awaiting Master d2t`, `· checks running`) use the CLAIMED treatment, with
     the gloss in holo-text-2.
```

**Code:** `verify.ts` (`claimOverlay` and `waitingOn`), `projection.ts` (`Claim.waiting_on`, an `overdue_at` of null when waiting, and the `openClaims` deadline), `next.ts:470` (use the overlay), `ClaimChip.svelte`, `Drawer.svelte`, and `TopBar.svelte` (counts are unchanged). Tests: an intake claim with no approval for 60 s is not unverified; a scaffolder with checks running is not unverified; a spawn with no `subagent_stopped` is unverified at 30 s.

### 4.4 Finding 6b — SCAFFOLD repairs what the factory can fix, inside the closed list

**Decision: yes, one bounded repair round, which never reaches the human.** It stays inside the closed ask list because it isn't an ask: it's an agent-to-agent retry, like a reviewer round. The human ask "SCAFFOLD failure" is unchanged. It's just raised *after* the repair round, with both rounds' failures on the card.

How it works:

1. The scaffolder reports `DONE`, and the CLI runs install, health and test (as now). If a check fails and `SCAFFOLD_REPAIR_ROUNDS` (1) isn't used up, `next` **resumes the same scaffolder** (AD-24 resume) with a repair brief: the failed checks, their redacted log tails (from fix 7), and the repair rules below. No card is raised.
2. The scaffolder does one of two things:
   - It fixes the problem inside the **repair envelope** and reports `DONE` with a revised contract. The CLI re-runs the checks, and a second failure raises the card.
   - It decides the cause is project-side (a missing secret, a database or service it can't start, a broken repo) and reports `ESCALATE` / `Scaffold failed: <why>`. The card is raised at once, without the round.
3. The card's reason lists both attempts: `round 1: contract.install failed (exit 1): … · repair: set PUPPETEER_SKIP_DOWNLOAD=1 · round 2: …`.

**The repair envelope** is what keeps this from becoming a back door around escalation 2 ("irreversible or outward action", "new dependencies") and CAP-4 ("no tracked file changes"):

- The scaffolder may change **only the run contract's commands**: environment variables, flags, the package manager's command form (`npm ci` → `npm ci --ignore-scripts && …`), and timeouts.
- It may point a tool's cache at a **run-local directory the CLI provides** (`runs/<run-id>/cache/`, passed as `FACTORY_CACHE_DIR`), for example `PUPPETEER_CACHE_DIR=$FACTORY_CACHE_DIR/puppeteer`. It **never deletes or edits** a cache or anything else outside the worktree. Redirecting a cache is reversible; deleting `~/.cache/puppeteer` isn't, and that's the user's machine.
- The existing gates still enforce the rest. `git.worktree_clean` fails any tracked-file change, and a lockfile change is a tracked-file change, so no new dependency. `git.baseline` still guards the main checkout. AD-27 already routes every install through the contract's `install`.
- The dry run's Puppeteer failure falls inside this envelope. The `node_modules` write into the main checkout (6a) is fixed already.

**Edits:**

```
SPEC.md — CAP-4 success
OLD: Brownfield: no tracked file in the target repo changes and the health check passes, or the human
     is paged before any code is written.
NEW: Brownfield: no tracked file in the target repo changes and the health check passes, or — after at
     most one factory repair round that changes only the run contract's commands — the human is paged
     before any code is written.

review-policy.md — closed list, SCAFFOLD row
OLD: | SCAFFOLD failure (project won't install/start/test) | Declared ask |
NEW: | SCAFFOLD failure (project won't install/start/test after the factory's one repair round, or the
       scaffolder names a project-side cause) | Declared ask |

review-policy.md — new section after "Human escalation — only these"
NEW: ## SCAFFOLD repair
     - One repair round before the SCAFFOLD failure ask: the scaffolder gets the failing checks and
       may change only the run contract's commands (env, flags, timeouts) and point tool caches at the
       run's own cache directory.
     - It never deletes or edits anything outside the worktree, changes a tracked file, or adds a
       dependency (escalation 2 still applies).
     - A project-side cause (secrets, services, a broken repo) skips the round.

pipeline-stages.md — SCAFFOLD row, Does
APPEND: On a failed check: one repair round (contract commands only), then the SCAFFOLD-failure ask.

ARCHITECTURE-SPINE.md — AD-21 constants
NEW: | SCAFFOLD_REPAIR_ROUNDS | 1 |

ARCHITECTURE-SPINE.md — AD-8, Brownfield (append)
NEW: A failed SCAFFOLD check resumes the scaffolder once with a repair brief (review-policy.md
     SCAFFOLD repair) before scaffold_failure is raised. paths.ts adds runs/<run-id>/cache/, exported
     to every contract command as FACTORY_CACHE_DIR.

agents/scaffolder.md — step 6
OLD: If the project can't install, start or test, write … `Scaffold failed: <one line why>`. The human decides.
NEW: If the project can't install, start or test because of the project itself (secrets, services, a
     broken repo), write … `Scaffold failed: <one line why>`. On a repair brief, fix only what the brief
     allows, or escalate the same way.
```

**Code:** `next.ts` `finishScaffold` (a repair resume before `raise`), `brief.ts` (the repair brief), `check.ts` (`FACTORY_CACHE_DIR` in the env), `paths.ts`, `config.ts`, `agents/scaffolder.md`, `cards.ts` (both rounds in the reason). Tests: one install failure, then a repair that passes, gives no card; a repair that fails gives a card with both rounds; `ESCALATE` on the repair gives a card at once; a repair that touches a tracked file fails `git.worktree_clean`.

### 4.5 Finding 8 — a read-only view of each pinned artifact, with copy-path

**It fits "a window, not a cockpit".** Viewing an artifact and copying its path change no run state, and approval still happens only by typing in the terminal. EXPERIENCE's Interaction Primitives already allow "copy a command" and "open or close evidence", and this adds two items to that list in the same spirit.

**How it's served: from event data, with no new route.** AD-23 ("The dashboard never reads `artifacts/`") stays exactly as it is. When the CLI verifies a step whose output a gate pins (intake, spec-writer, designer, slicer), it embeds in `step_verified.data` the **redacted** body, the `sha256` of the file as written, and its path. The board shows those bytes. Compared with a file-serving route, this means:

- no path traversal or filesystem surface in the dashboard, and still GET-only;
- the bytes shown are the bytes the gate pinned (AD-10). The view shows `sha256 …` and, after the pass, `pinned by Gate 1 · Master d2t`. A rework shows the older version as superseded;
- redaction goes through the one `redact.ts` (AD-14), at write time and again at record;
- replay gets it for free, because recordings carry it.

The size is capped at `ARTIFACT_EMBED_MAX` (64 KB) with a visible truncation note. The spec is at most 40 lines, so the cap matters only for an unusually long `design.md`.

**Where it shows:** a third Evidence drawer variant, **Artifact**. It opens from a Gate card's file row (spec, design, plan), from the intake seal, and from the Decision drawer's "evidence checked" rows. Its contents: the title `Artifact · spec.md · <run-id>`, a meta row (path with a Copy-path button, sha256, `pinned by …` or `not yet approved`), then the body in monospace, read-only, scrollable, with no Markdown rendering (what the gate pins is the bytes, not a rendering). Copy-path copies the absolute path, so the human can open it in an editor, and it follows the existing Copy command behaviour (`Copied` or `Copy failed — path selected`).

**Edits:**

```
SPEC.md — CAP-15 intent (append)
NEW: …and lets the human read, read-only, each artifact a gate pins, and copy its path.

truth-layer.md — Dashboard (add bullet)
NEW: Artifact view: the redacted text of each gate-pinned artifact, carried in event data — never
     read from disk by the dashboard.

ARCHITECTURE-SPINE.md — AD-23 (add to the list)
NEW: - the pinned artifacts: at step_verified of an intake, spec-writer, designer or slicer step, the
       redacted body (≤ ARTIFACT_EMBED_MAX, else truncated and marked), its sha256 and path.
     The dashboard never reads artifacts/ (unchanged).

ARCHITECTURE-SPINE.md — AD-21 constants
NEW: | ARTIFACT_EMBED_MAX | 64 KiB |

EXPERIENCE.md — Evidence drawer variants (add row)
NEW: | Artifact | A Gate card's file row, the intake seal, or a Decision drawer evidence row |
       `Artifact · <name> · <run-id>` | path + Copy path · sha256 · pinned by <seal line> | not yet
       approved · body (monospace, read-only) | None |

EXPERIENCE.md — Interaction Primitives, Read-only
OLD: The only actions: copy a command, open or close evidence, …
NEW: The only actions: copy a command or an artifact path, open or close evidence (including an
     artifact view), …

DESIGN.md — Panels, Evidence drawer (add variant)
NEW: Artifact (from a file row or seal): title `Artifact · spec.md · r-7f3a`; meta table (92px key
     column): path (mono, with the 30×30 Copy button), sha256 (first 12, full in the accessible name),
     pinned (seal line in gold, or `not yet approved` in text-3); body in `data` type on space-0,
     scrolling inside the drawer; a `truncated at 64 KB` note when cut. Note with gold left rule:
     **Master d2t approves these bytes.**
```

**Code:** `steps.ts` / `done.ts` (embed at `step_verified`), `redact.ts` (reused), `config.ts`, `projection.ts` (an artifacts map on each card), `Drawer.svelte` (the Artifact variant), `NeedsYouCard.svelte` (file rows as buttons), and a copy helper. Tests: the redacted body is embedded and a secret doesn't appear; the sha matches the gate's pin; a rework marks the old version superseded; truncation at the cap; the projection never touches `artifacts/` (an existing test, kept).

### 4.6 Finding 9 — the Stop hook yields to the human, and the block cap is the factory's

**What went wrong.** At 15:24:41 the human rejected `factory done`. The conductor's turn went on, and every attempt to stop hit `mayStop` = false (step `spawn d2t-factory:reviewer-ui` claimed, nothing in the background). AD-12 blocks "whatever `stop_hook_active` says", so the hook fought the human until Claude Code's cap ended the turn.

**What Claude Code actually does** (hooks reference, code.claude.com/docs/en/hooks.md, checked today):

- **Interrupt.** "[Stop] does not run if the stoppage occurred due to a user interrupt." Esc or Ctrl+C already ends the turn, and the factory never sees it. No change is needed there, only a test that nothing depends on Stop firing after an interrupt.
- **Rejected tool call.** Undocumented: the docs don't say whether the turn continues or whether Stop fires afterwards. The dry run shows it continues and Stop fires. A manual denial fires `PreToolUse` but neither `PostToolUse` nor `PostToolUseFailure`, and `PermissionDenied` fires only in auto mode. The transcript schema is undocumented too.
- **The cap.** "After stop hooks have continued the turn eight times in a row, Claude Code overrides the next block and ends the turn. The count of consecutive continuations resets each time Claude calls a tool." That's the dry run exactly: 8 continuations, and the 9th block overridden. Nothing is exposed to hooks at the cap. `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises it.

So CAP-14's "can't stop while working" already ends at Claude Code's cap, silently, and nothing records it.

**Decision.** There are two narrow exits. Both are recorded, and both are decided by the factory, not by the conductor's say-so:

1. **A human rejection yields.** The Stop hook allows the stop when **the current turn holds a tool use the human rejected**. The CLI reads this from **the session's own transcript**, located the AD-6 way (realpath under `~/.claude/projects/`, never from a fact), and checks only the entries after the turn's last human prompt. It matches the structured record Claude Code writes for a rejection, never a substring, so an echoed string can't match. The hook appends `stop_yielded{reason: human_rejected, tool_use_id}`.
   - *Why this doesn't reopen CAP-14's hole.* The hole is the conductor deciding by itself to stop mid-work. The conductor can't write a rejection into its own transcript: the guard denies writes under `~/.claude/projects/` (AD-31), and like AD-6 the check relies on the transcript, not on anything the model says. Rejections by a deny rule or by the factory's own guard aren't human, so they don't match.
   - *Spike first.* The rejection record is undocumented, so story 6-1 starts by rejecting a tool call in a real session and pinning the record as a test fixture. As corroboration, `PreToolUse` can log `tool_requested{tool_use_id}`. A rejected call then has a request with no `tool_*` outcome, but that alone isn't enough, because a deny rule gives the same shape. **Fallback** if the transcript carries no reliable record: exit 2 alone. That still fixes the dry run's symptom (3 blocks, then a recorded stop, not 9 silent ones).
2. **The factory's own block cap, below Claude Code's.** The hook counts consecutive blocks for the holder session (`~/.factory/sessions/<session>.stop`). It resets the count the way Claude Code does, when the conductor calls a tool (a `tool_*` fact from that session newer than the last block), and also on a human prompt. At `STOP_BLOCK_MAX` (3) it lets the stop through and appends `stop_forced{blocks, reason}`. The factory then decides and records the exit, instead of reaching Claude Code's cap silently, and a raised `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` changes nothing. Three is enough: the right response to a block is a tool call (`factory next`), which resets the count, so only a conductor that answers three blocks in a row with text alone is let go.

**After either exit**, the run isn't parked and isn't lost. The `SessionStart` nudge (AD-12) and the next human turn resume it with `factory next`. On the dashboard, `stop_yielded` and `stop_forced` show as a lane notice (`PAUSED · you rejected a tool call 15:24` / `PAUSED · the conductor stopped after 3 blocks 15:24`). This is dashboard-only, like SIGNAL LOST, so CAP-10's closed list is unchanged. `stop_forced` is also the honest signal that CAP-14 was strained.

**Edits:**

```
SPEC.md — CAP-14 success
OLD: …the conductor cannot end a turn while its run is working (it may stop when awaiting the human,
     waiting on background work, or terminal); …
NEW: …the conductor cannot end a turn while its run is working (it may stop when awaiting the human,
     waiting on background work, or terminal, or when the human rejected a tool call in that turn,
     read from the session's own transcript; a human interrupt ends the turn without Stop firing); a
     stop let through at the factory's block cap is recorded and shown on the dashboard; …

truth-layer.md — Semantics, Stop bullet
OLD: Stop hook blocks the conductor from ending a turn while its run is working; stopping is allowed
     when every open step awaits the human or runs in the background, or the run is terminal.
NEW: …; also when the turn holds a tool call the human rejected (from the session's own transcript).
     After STOP_BLOCK_MAX consecutive blocks with no tool call between them, the hook lets the stop
     through and records it.

ARCHITECTURE-SPINE.md — AD-12, Rule
OLD: Otherwise the hook blocks, whatever stop_hook_active says. Claude Code's 8-continuation cap is the backstop.
NEW: - Human rejection. The hook also allows the stop when the session's own transcript (located as in
       AD-6) holds, after the turn's last human prompt, a tool use the human rejected, matched on
       Claude Code's structured record (fixture pinned by 6-1), never on a substring. It appends
       stop_yielded{reason, tool_use_id}. A user interrupt never reaches Stop (Claude Code skips it).
     - Otherwise it blocks, whatever stop_hook_active says, up to STOP_BLOCK_MAX consecutive blocks for
       the holder session (counter in sessions/<session>.stop; reset by a tool_* fact from that
       session after the last block, or by a human prompt). The next stop then passes and appends
       stop_forced{blocks}. Claude Code's own cap (8 continuations, also reset by a tool call) is
       never reached.
     - Both facts are a dashboard-only lane notice (PAUSED); the SessionStart nudge resumes the run.

ARCHITECTURE-SPINE.md — AD-21 constants
NEW: | STOP_BLOCK_MAX | 3 |

ARCHITECTURE-SPINE.md — Open Questions, Stop and nudge row (append to Outcome)
NEW: Dry run 1: blocking after a human rejection fought the human until Claude Code's cap (8
     continuations, then an override); amended with the rejection exit and STOP_BLOCK_MAX (AD-12).

EXPERIENCE.md — State Patterns, Lanes and runs (add row)
NEW: | PAUSED | Swimlane header | `PAUSED · you rejected a tool call 15:24` (stop_yielded) or
       `PAUSED · the conductor stopped after 3 blocks 15:24` (stop_forced), in text-2 beside the stage;
       clears on the run's next command. Dashboard-only, never a chat prompt (CAP-10). |
```

**Code:** `hooks/stop.ts` (the counter, the transcript check, the facts), a transcript reader shared with `decide` (move the AD-6 locator from `cli/` into `store/` so hooks can use it), `hooks/guard.ts` (`tool_requested`, if the spike keeps it), `config.ts`, `projection.ts` (the lane notice), `Lane.svelte`. Tests: the pinned rejection fixture yields; a model-echoed rejection string doesn't; a deny-rule denial doesn't; a fourth text-only block passes and records `stop_forced`; a tool call between blocks resets the count; a human prompt resets it; non-holder and unbound sessions still pass.

### 4.7 Stories (new epic 6)

```yaml
- id: "6-1"
  title: Stop hook yields to the human; factory-owned block cap
  description: >-
    Starts with a spike that pins Claude Code's transcript record of a human-rejected tool call
    as a fixture; then the rejection exit and STOP_BLOCK_MAX in the Stop hook, with stop_yielded /
    stop_forced facts and the PAUSED lane notice (finding 9, CAP-14). If the spike finds no
    reliable record, ship exit 2 alone.
  invoke_dev_with: "Governing decisions: AD-6 (transcript locator), AD-12, AD-21, AD-31."

- id: "6-2"
  title: Cards that say what's next; intake task and scope; optional time limit
  description: >-
    Card options/then/reply/details on every card, intake task and scope, optional limit_min
    with the elapsed-time clock, neutral wording (findings 2, 3, 4; CAP-2, CAP-11).
  invoke_dev_with: "Governing decisions: AD-17, AD-27, AD-34. Additive within v:1 (AD-32)."

- id: "6-3"
  title: Claim waiting states and pinned-artifact view
  description: >-
    waiting_on in the claim overlay shared by CLI and board; redacted pinned artifacts in
    step_verified data and the Artifact drawer with copy-path (findings 5, 8; CAP-15).
  invoke_dev_with: "Governing decisions: AD-7, AD-10, AD-14, AD-23. The dashboard never reads artifacts/."

- id: "6-4"
  title: SCAFFOLD repair round
  description: >-
    One scaffolder repair round within the repair envelope before the SCAFFOLD failure ask,
    with a run-local cache dir (finding 6b; CAP-4, review-policy.md).
  invoke_dev_with: "Governing decisions: AD-8, AD-21, AD-24 (resume), AD-27."
```

Order: 6-1 first (it blocks dry run 2). 6-2, 6-3 and 6-4 are independent and can run in any order. 6-3 bundles 5 and 8 because both change the Claim/Evidence drawer and the projection's card shape.

## 5. Implementation handoff

**Scope: moderate.** The contract docs change first (one doc pass, the edits above), then four stories through the usual build route. No re-plan by PM or Architect is needed: the edits stay inside existing ADs, and the only new semantics (Stop exits, the repair round) are spelled out above.

| Who | Does |
|---|---|
| Developer (this session or `bmad-build`) | Applies the section 4 doc edits in one commit; adds epic 6 to `stories.yaml` and the story files; builds 6-1, then 6-2 to 6-4 |
| d2t | Approves this proposal, confirms the per-card `reply` lines (4.2) and the `STOP_BLOCK_MAX` / repair-round numbers, does the 6-1 spike's one manual step (reject a tool call in a test session), then runs dry run 2 |

**Success criteria:**

- Dry run 2: no human prompt outside the closed list. The intake card shows the agreed task and scope. Every card printed in chat has its `then` lines and reply line. No red UNVERIFIED appears on a claim waiting on the human or on checks. Rejecting a tool call ends the turn at once and the lane shows PAUSED. A run started with no time limit shows elapsed time and never raises a cut.
- The full test suite passes, and every recording fixture folds byte-identical (AD-32), except where a change is deliberate and noted.
