---
title: 'Sprint change proposal: dry run 2 findings 1, 2, 5'
date: '2026-10-26'
status: 'approved'
approved: '2026-10-26'
mode: 'batch'
trigger: '_bmad-output/implementation-artifacts/dry-run-2-findings.md'
scope: 'moderate'
---

# Sprint Change Proposal — dry run 2, findings 1, 2, 5

## 1. Issue summary

Dry run 2 (2026-10-26, brownfield, `maciekt07/TodoApp`, run `i-want-to-add-an-optiona-znad`) reached the merge gate with three slices closed and all five reviewers approving. The merge then failed in WRAP. Findings 3, 4 and 4b (the WRAP merge order and a stranded failed merge) are already fixed (`spec-dry-run-2-wrap-merge-fix.md`, `spec-dry-run-2-worktree-exit-and-removal.md`, commits `50ce7f5`, `ed681e0`). This proposal covers the three findings that needed a decision first:

| # | Kind | Problem, in one line | Root cause in the contract |
|---|---|---|---|
| 1 | dashboard | Recon, framer, scaffolder, spec-writer and slicer have no character. They are drawn as the conductor (`vess`) and named by their raw role id. | The spine's deviation table (row "agents without a roster character") decided "Shown as the conductor", and EXPERIENCE gives RECON/FRAME "no sprite on the card". In practice each is a real subagent with its own claim chip, so the board shows anonymous claims. |
| 2 | dashboard | The CLI's checks show by internal id (`contract.install`, `contract.health`, `contract.test`). | A `run_check` step's claim takes `role = st.check` (`projection.ts:303`), and nothing maps a check to a display name. `spec.lint` and `plan.lint` reach the board the same way, so they show raw ids too. |
| 5 | design | After the merge failed, the conductor decided on its own to retry outside the sandbox and suggested a `/sandbox` change to the human. Neither step is in the closed list. | AD-35 says "The factory never bypasses the sandbox", but only as part of setup. The conductor skill says "never improvise" and never names the sandbox. Claude Code's own system prompt tells the model to retry with `dangerouslyDisableSandbox` and to point the user at `/sandbox`, and that won. The dry run ran in `bypassPermissions`, so nothing stopped the retry. |

The evidence is in `dry-run-2-findings.md` rows 1, 2 and 5, the archived run (`~/.factory/archive/dry-run-2-2026-10-26/`) and the session transcript.

## 2. Impact analysis

### Epics and stories

All 19 planned stories (0-1 … 6-4) are built, and none is invalidated. Each change amends behaviour that a finished story shipped:

| Finding | Stories it amends |
|---|---|
| 1 | 2-2 (Agent sprite, Character roster), 1-4 / 3-2 / 3-3 / 5-2 (the stages these roles own) |
| 2 | 2-2 (claim rows, drawer), 6-3 (the `waiting on` checks gloss) |
| 5 | 1-3 (the PreToolUse guard), 1-2 (conductor skill), every agent brief (`brief.ts`) |

**Proposed:** a new epic 7, *Dry run 2 product changes*, with two independent stories (section 4.4). Story 7-1 (the sandbox rule) goes first because it changes how dry run 3 behaves when a command fails. Story 7-2 (personas and check droids) is visual only.

### Artifact conflicts

| Artifact | Sections affected |
|---|---|
| `SPEC.md` | Constraints (new sandbox bullet), CAP-10 success |
| `review-policy.md` | Closed list, footer |
| `ARCHITECTURE-SPINE.md` | AD-31 (guard), AD-35 (rule), the deviation table (row removed) |
| `DESIGN.md` | Role color tokens, Colors (role colors), Character roster, new Check droids table, Agent sprite |
| `EXPERIENCE.md` | Stage lifecycle (RECON/FRAME, SCAFFOLD, SPEC ∥ DESIGN, SLICE PLAN), Voice and Tone rules, Agent sprite |
| `skills/factory/SKILL.md`, `src/cli/brief.ts` | The rule itself, for the conductor and for every agent |
| `README.md` | Sandbox section: the factory never asks you to change it |

### Technical impact

No new process, route, dependency, write path or event. Finding 5 adds one check to an existing hook. Findings 1 and 2 change display only: roles and check ids stay the same strings in events, so old recordings replay unchanged and simply gain names and sprites. The one projection change is an additive `BoardCard` field (`checks_running`), not an event change (AD-32 is unaffected).

## 3. Recommended approach

**Direct adjustment** (checklist option 1): amend the contract, then two small stories. A rollback (option 2) gains nothing, because the shipped code is sound and only incomplete. An MVP review (option 3) isn't needed: finding 5 protects the success signal ("only the asks listed in `review-policy.md` reaching the human"), and findings 1 and 2 make the board say who did each piece of work.

- **Effort:** low to medium. 7-1 low (one guard check, two prompt lines, docs). 7-2 medium (ten placeholder sprites, roster tables, one projection field).
- **Risk:** low. 7-1 could deny a command a step needs unsandboxed, but no factory path needs one (the merge now runs from the main checkout, and process cleanup is the human's, per the README). A denial surfaces as an ordinary error, not a silent failure.
- **Timeline:** about one dev session per story, then dry run 3.

## 4. Detailed change proposals

### 4.1 Finding 5: factory sessions never leave the sandbox, and never ask the human to loosen it

**Decision.** In a factory-bound session neither the conductor nor any agent runs a command with `dangerouslyDisableSandbox`, and neither suggests a sandbox, permission or settings change to the human (`/sandbox`, `settings.json`, allow rules). Three reasons:

- **CAP-10.** "Please loosen your sandbox" is a human ask, and it's not in the closed list. Adding a "sandbox exception" ask would widen CAP-10 for a case the factory's own design should rule out.
- **AD-35 already owns what the factory needs from the machine.** If a step fails on a sandbox denial, that is a factory defect, the same family as dry run 1 finding 1 and dry run 2 finding 3. It gets fixed in `factory setup`, in the order of steps, or in the README, not improvised mid-run.
- **The prompt alone lost.** The conductor skill already said "never improvise" and "never retry on your own". Claude Code's default instructions to retry unsandboxed were more specific, so they won. The rule therefore names the sandbox explicitly, and a tripwire enforces it, like the AD-31 write guard.

**What happens instead when the sandbox denies something:**

| Where | Path (all existing) |
|---|---|
| A CLI check (`contract.*`, `git.merged`, lints) | The check fails and records the error. The step's card (SCAFFOLD failure, merge card) carries it in its reason. |
| An agent's command | The agent reports a failure or `ESCALATE` with that error. The normal review or escalation path follows. |
| A `factory` call the conductor makes | The CLI's `{"error": …}` answer. The conductor prints it in one line and ends the turn (the skill's existing error rule). If the run is still working, the Stop hook's block cap and the `PAUSED` lane notice apply (AD-12). |

**Enforcement.** The PreToolUse guard (AD-31) denies, in a bound session, any `Bash` call whose `tool_input.dangerouslyDisableSandbox` is `true`, whether from the conductor or from a subagent. The hook input already carries the field (spike 03: `PreToolUse Bash … dangerouslyDisableSandbox=false`). The deny reason tells the model what to do instead:

```
factory guard: factory sessions run every command inside the sandbox (AD-35). Report the failure as
it is; don't retry outside the sandbox and don't ask the human to change sandbox or permission
settings.
```

With the sandbox off, the flag does nothing, so denying it costs nothing. Like the rest of the guard, this is a tripwire. It catches the model following Claude Code's default advice. It is not a boundary against someone running as the user (AD-31 threat model).

**Edits:**

```
SPEC.md — Constraints (add after "Factory hooks never alter non-factory sessions.")
NEW: - Factory sessions run every command inside the user's sandbox and never ask the human to loosen
       it; what the factory needs from the machine is set up once by `factory setup`.

SPEC.md — CAP-10 success (append)
NEW: …; no chat message asks the human to change sandbox or permission settings, and no factory
     command runs outside the sandbox.

review-policy.md — closed list, footer (append)
NEW: A request to change sandbox or permission settings is never an ask: the factory doesn't make
     one, and it never runs a command outside the sandbox (AD-35).

ARCHITECTURE-SPINE.md — AD-35, Rule (new bullet after the `factory setup` list)
NEW: - **The sandbox is never bypassed.** In a factory-bound session neither the conductor nor an
       agent runs a command with `dangerouslyDisableSandbox`, and neither suggests a sandbox,
       permission or settings change to the human. A sandbox denial is an ordinary failure on the
       path that hit it (a failed check, an agent failure or escalation, a CLI error). A step that
       needs more than the sandbox allows is a factory defect, fixed in setup, in the order of steps,
       or in the README (dry run 2).
OLD: …from the main checkout, which is then the session's cwd (AD-8, dry run 2). The factory never
     bypasses the sandbox;
NEW: …from the main checkout, which is then the session's cwd (AD-8, dry run 2);

ARCHITECTURE-SPINE.md — AD-31, The guard (new bullet)
NEW: - It also denies, in a bound session, a `Bash` call with `dangerouslyDisableSandbox: true`, from
       the conductor or an agent (AD-35). The flag is in the hook input; with no sandbox it is a no-op,
       so the denial costs nothing.

skills/factory/SKILL.md — Rules (new bullet after "Never run git yourself")
NEW: - Never run a command outside the sandbox (`dangerouslyDisableSandbox`), and never suggest a
       sandbox, permission or settings change (`/sandbox`, `settings.json`) to the human. This
       overrides Claude Code's default advice. A sandbox denial is an error like any other: report it
       as the rule for errors says; the factory's own paths carry it to the human.

src/cli/brief.ts — the shared lines every brief carries (new line)
NEW: Run every command inside the sandbox: never set `dangerouslyDisableSandbox`. If the sandbox
     blocks something you need, report it as your failure or escalation; don't work around it.

README.md — sandbox section (append)
NEW: The factory never runs a command outside the sandbox and never asks you to change it mid-run.
     If a run fails on a sandbox denial, that's a factory bug: report it. Setup covers what the
     factory needs.
```

**Code:** `src/hooks/guard.ts` (the deny, before the path checks), `skills/factory/SKILL.md`, `src/cli/brief.ts`. **Tests:** a bound conductor's `Bash` with the flag `true` is denied with the reason above; the same from a subagent is denied; `false` or absent goes through the existing checks unchanged; an unbound session is untouched. One check to run by hand in dry run 3: the guard's deny still applies under `bypassPermissions` (hooks run before the permission mode is applied, but the dry runs never exercised a guard deny in that mode).

### 4.2 Finding 1: every agent role gets a character

**Decision.** Recon, framer, scaffolder, spec-writer and slicer each get an original character: a name, a 16×16 placeholder sprite, a role color and a row in the Character roster. Each stands at its stage card while that stage is In Progress, as Sela Venn does at DESIGN. The conductor keeps the Swimlane header and the stages it really runs itself (INTAKE and WRAP).

The characters keep the board's rules: Old Republic in spirit only, original names, a plain role label beside every name, and the display (short) name everywhere. Every name below must pass the DESIGN hard rule (no Star Wars names, species or likenesses) before it ships, and any of them can be renamed in review.

| Name (short) | Role | Look | Role color | Signature on board |
|---|---|---|---|---|
| Pathfinder Nyra Kest (`Nyra`) | recon | Hooded scout with a survey scanner | `{colors.role-recon}` olive `#b8c25e` | Scanner sweep: a 3-frame cone in front of her |
| Shipwright Halden Roe (`Halden`) | framer | Shipwright with a blueprint roll | `{colors.role-framer}` olive `#b8c25e` (shared with recon, see below) | Blueprint unrolls and rolls, 1.4 s cycle |
| Dockmaster Orla Brann (`Orla`) | scaffolder | Dock officer with a cargo manifest and a hand lamp | `{colors.role-scaffolder}` orchid `#d68ae6` | Hand lamp blinks as she checks the manifest |
| Magistrate Ione Vatch (`Ione`) | spec-writer | Formal robes, charter tablet | `{colors.role-spec-writer}` periwinkle `#8ea2ff` | Tablet lines appear one by one, 1.2 s cycle |
| Tactician Sorel Danth (`Sorel`) | slicer | Officer at a small holo-map, moving markers | `{colors.role-slicer}` peach `#f2c7a0` (`sprite-skin-light`) | Markers blink into slots on the map |

**Colors.** The board already has 7 role hues and 4 state hues (gold, cyan, red-orange, amber), so free hues are scarce. The five new colors avoid the state hues and their neighbours: no gold or sand, no cyan, no copper, rust or coral. Recon and framer share olive because they are the same stage slot (CAP-3: either RECON or FRAME runs, never both in one lane). If UX would rather keep "one color per role", the alternative for framer is bone `#e9dcc4`. Every new token must meet the existing 3:1 non-text floor on `space-2`, and UX checks it against its neighbours with the same contrast check DESIGN used for the original seven.

**Edits:**

```
DESIGN.md — front matter, Role colors (add)
NEW: role-recon: '#b8c25e'
     role-framer: '#b8c25e'
     role-scaffolder: '#d68ae6'
     role-spec-writer: '#8ea2ff'
     role-slicer: '#f2c7a0'

DESIGN.md — Character roster (add five rows, as in the table above)

DESIGN.md — Colors, Role colors paragraph (append)
NEW: Recon and framer share olive: they fill the same stage slot and never appear in one lane.
     New role colors avoid the state hues and their neighbours (gold/sand, cyan, red-orange/copper,
     amber) and meet the 3:1 non-text floor on space-2.

DESIGN.md — Components, Agent sprite (append)
NEW: Every agent role has a character (Character roster); none is drawn as the conductor. The
     conductor appears only in the Swimlane header.

EXPERIENCE.md — Stage lifecycle, RECON / FRAME, Path on board
OLD: None. No sprite on the card; the conductor in the Swimlane header owns this stage.
NEW: None. Nyra (recon) or Halden (framer) stands at the card while it is In Progress.

EXPERIENCE.md — Stage lifecycle, SCAFFOLD, Path on board
OLD: In Progress → Done
NEW: In Progress (Orla; check droids beside her while the contract checks run) → Done

EXPERIENCE.md — Stage lifecycle, SPEC ∥ DESIGN, Path on board
OLD: Both In Progress in parallel (Sela Venn on DESIGN) → …
NEW: Both In Progress in parallel (Ione on SPEC, Sela Venn on DESIGN) → …

EXPERIENCE.md — Stage lifecycle, SLICE PLAN, Path on board
OLD: In Progress → Needs You card (GATE, Gate 2) → Done
NEW: In Progress (Sorel) → Needs You card (GATE, Gate 2) → Done

EXPERIENCE.md — Voice and Tone, Rules
OLD: Characters use their display (short) name everywhere — `Quill`, `Tarvus`, `Pell`, `Adm. Vess Korrin`
NEW: Characters use their display (short) name everywhere — `Quill`, `Tarvus`, `Pell`, `Nyra`,
     `Adm. Vess Korrin` — and every agent role and CLI check has one; no raw role or check id appears
     where a name belongs.

ARCHITECTURE-SPINE.md — deviation table
REMOVE: | EXPERIENCE: agents without a roster character (`recon`, `framer`, `scaffolder`, `spec-writer`,
          `slicer`) | Shown as the conductor |
```

**Code:** `sprites.ts` (five 16×16 two-frame placeholders from the shared palette, `SpriteName`, `BY_ROLE`), `model.ts` (`ROSTER` rows), `lib/tokens.css` (`--role-*`), `Lane.svelte` `agentsAt` (an In Progress stage card shows its stage's role: RECON→recon, FRAME→framer, SCAFFOLD→scaffolder, SPEC→spec-writer, SLICE PLAN→slicer; DESIGN stays), and `Sprite.svelte` (effect timings). **Tests:** every role in the spine's role list maps to a sprite other than `vess` and to a roster name; `agentsAt` for each stage card.

### 4.3 Finding 2: the CLI's checks are droids

**Decision.** Every CLI check that becomes a `run_check` step gets a droid name. All of them share one chassis sprite and one look. They are the factory's instruments, not agents: the CLI runs them, and their results are the evidence that verifies the agents' claims. One uniform chassis says "machine", and five distinct droids would say "five more agents".

| Name (short) | Check | Role label | Look |
|---|---|---|---|
| LX-4 "Crate" (`Crate`) | `contract.install` | `install check` | Shared check-droid chassis: a small box body on treads with one round photoreceptor and a status light |
| VT-2 "Pulse" (`Pulse`) | `contract.health` | `health check` | same |
| TQ-6 "Gauge" (`Gauge`) | `contract.test` | `test check` | same |
| MR-3 "Margin" (`Margin`) | `spec.lint` | `spec lint` | same |
| PL-5 "Tally" (`Tally`) | `plan.lint` | `plan lint` | same |

The droids get no role color. Their dot is a 6 px **outlined** square (1 px `text-2`), not a filled one. The shape marks "the factory's own check" without adding a thirteenth hue, and it never means state. The status light on the chassis uses `sprite-holo` while the check runs (decoration only, like every sprite effect). The pass or fail still shows only in the claim chip.

Pell (P-11, reviewer-a11y) stays the only protocol droid. The check droids are a different, smaller chassis, so the two don't blur.

**Where they show:**
- **Claim rows, verdict rows and the Evidence drawer:** the droid's display name replaces the raw id (`Pulse`, not `contract.health`), through the same `displayName` lookup.
- **On the board:** while a card's `run_check` steps are issued and not yet verified, their droids stand beside the card's agent (or alone). That's the SCAFFOLD card during install, health and test, a slice card during its BUILD checks, the WRAP card during its re-checks, and SPEC or SLICE PLAN during their lints. This needs one additive projection field, `BoardCard.checks_running: Check[]`.
- **The `waiting on` gloss (6-3) stays as check names** (`waiting on health, test`). These are the checks' role labels, and the drawer row beside them already names the droids.

Checks that never become a `run_check` step (`git.baseline`, `git.worktree_clean`, `git.deps`, `git.merged`, `devserver`) appear only as evidence rows. Those rows keep their check names, because they label evidence, not an actor.

**Edits:**

```
DESIGN.md — new subsection after Character roster
NEW: ### Check droids
     The CLI's own checks, drawn as one shared droid chassis (small box body on treads, one
     photoreceptor, a status light). They are instruments, not agents: no role color; their dot is
     a 6px outlined square (1px text-2). Name + role label as for characters.
     | Name (short) | Check | Role label |
     | LX-4 "Crate" (`Crate`) | contract.install | install check |
     | VT-2 "Pulse" (`Pulse`) | contract.health | health check |
     | TQ-6 "Gauge" (`Gauge`) | contract.test | test check |
     | MR-3 "Margin" (`Margin`) | spec.lint | spec lint |
     | PL-5 "Tally" (`Tally`) | plan.lint | plan lint |
     Signature: the status light blinks in sprite-holo while the check runs; frame 1 when idle.

DESIGN.md — Components, Agent sprite (append)
NEW: Check droids stand beside the card whose checks are running, at the agent scale; they leave
     when their check is verified.

EXPERIENCE.md — Component Patterns, Agent sprite (append)
NEW: Check droids (`DESIGN.md` Check droids) appear while their check runs and leave when it is
     verified. A check's claim, verdict and drawer rows name its droid.

ARCHITECTURE-SPINE.md — AD-23 (projection, add)
NEW: - per card, `checks_running`: its run_check steps issued and not yet verified (display only).
```

**Code:** `sprites.ts` (one `droid` chassis map; `spriteFor` maps each run_check id to it), `model.ts` (`ROSTER` gains the five check ids with names and an `outline: true` dot), `ClaimList.svelte` / `Agent.svelte` (outlined dot), `projection.ts` (`checks_running`), `Lane.svelte` `agentsAt` (append the running droids). **Tests:** `displayName` for each `run_check` id; `checks_running` on a SCAFFOLD card with install verified and health issued is `['contract.health']`; replaying an epic-6 recording shows droid names with no projection error.

### 4.4 Stories

```yaml
- id: "7-1"
  title: Factory sessions never leave the sandbox
  description: >-
    The guard denies Bash with dangerouslyDisableSandbox in bound sessions (conductor and agents);
    the conductor skill and every brief forbid bypassing the sandbox or asking the human to change
    sandbox or permission settings; README note (dry run 2 finding 5; CAP-10, AD-35).
  invoke_dev_with: >-
    Governing decisions: AD-31 (guard), AD-35. Source:
    planning-artifacts/sprint-change-proposal-2026-10-26.md section 4.1.

- id: "7-2"
  title: Every agent role has a character; the CLI's checks are droids
  description: >-
    Characters for recon, framer, scaffolder, spec-writer and slicer standing at their stage cards;
    one shared check-droid chassis named per run_check id, shown while the check runs and in claim
    and drawer rows (dry run 2 findings 1, 2; CAP-15).
  invoke_dev_with: >-
    Governing decisions: AD-23 (checks_running is projection-only), AD-32 (no event change). Visual
    rules: DESIGN.md Character roster, Check droids. Source: sprint-change-proposal-2026-10-26.md
    sections 4.2, 4.3.
```

## 5. Implementation handoff

**Scope: moderate.** The contract changes are small and agreed above. The backlog gains an epic and two stories, then the Developer implements them.

| Who | Does |
|---|---|
| Developer (contract edits) | Apply the edits in 4.1–4.3 to `SPEC.md`, `review-policy.md`, `ARCHITECTURE-SPINE.md`, `DESIGN.md` and `EXPERIENCE.md`; append 7-1 and 7-2 to `stories.yaml`; mark findings 1, 2 and 5 in `dry-run-2-findings.md` as decided here. |
| Developer (7-1, first) | The guard check, the skill and brief lines, the README note, with tests. |
| Developer (7-2) | Ten placeholder sprites (five characters, one droid chassis, used five times), the roster and token additions, `checks_running`, with tests. Run the names through the DESIGN hard rule and the colors through the contrast check before merging. |
| d2t | Approve this proposal; rename any character or droid in review if you like. |

**Done when:**
- In a bound session, a `Bash` call with `dangerouslyDisableSandbox: true` is denied for the conductor and for agents, and the conductor's skill and every brief state the rule.
- No raw role id or `run_check` id appears as a name on the board. Every agent role has a sprite other than the conductor's, and each stage card shows its agent while In Progress.
- Check droids appear beside a card exactly while its checks run.
- An epic-6 recording replays with the new names and no other change.
- Dry run 3 (to be run): no chat message asks the human to change sandbox or permission settings, and every human prompt maps to one ask in `review-policy.md`.
