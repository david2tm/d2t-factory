# Epic 7 Context: Dry Run 2 Product Changes

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Dry run 2 reached the merge gate, then exposed three problems that shipped stories can't fix without amending the contract. First, after a failed merge the conductor retried outside the sandbox on its own and told the human to loosen `/sandbox`. Claude Code's default advice beat the skill's "never improvise", and that human ask is not in the closed list. Second, recon, framer, scaffolder, spec-writer and slicer are drawn as the conductor and labelled with raw role ids. Third, CLI checks appear on the board by internal id (`contract.health`, `spec.lint`). This epic enforces the sandbox rule and gives every board actor a name. Stories 1-1 to 6-4 stay valid; this epic adds to them. It adds no process, route, dependency, write path or event. Note: 7-1 applied its contract edits (SPEC, review-policy, spine AD-31/AD-35). The 7-2 edits (spine AD-23 and its deviation table, DESIGN, EXPERIENCE) are still to apply as part of 7-2.

## Stories

- Story 7.1: Factory sessions never leave the sandbox
- Story 7.2: Every agent role has a character; the CLI's checks are droids

## Requirements & Constraints

- **Sandbox (CAP-10, 7-1).** In a factory-bound session, neither the conductor nor any agent:
  - runs a command with `dangerouslyDisableSandbox`;
  - suggests a sandbox, permission or settings change to the human (`/sandbox`, `settings.json`, allow rules).

  A sandbox denial is an ordinary failure on whatever path hit it:
  - a failed CLI check, whose reason the step's card carries;
  - an agent failure or `ESCALATE`, which then follows the normal review or escalation path;
  - a CLI `{"error": …}` answer, which the conductor prints in one line before ending the turn. The Stop block cap and the PAUSED notice still apply.

  If a step needs more than the sandbox allows, that is a factory defect. It gets fixed in `factory setup`, in the order of steps, or in the README, never mid-run.
- **CAP-10 success** gains a clause: no chat message asks the human to change sandbox or permission settings, and no factory command runs outside the sandbox. The closed list states that such a request is never an ask.
- **Names on the board (CAP-15, 7-2).**
  - No raw role id or `run_check` id appears where a name belongs.
  - Every agent role has a sprite other than the conductor's, and each stage card shows its agent while In Progress.
  - Check droids appear beside a card exactly while its checks run.
- **Replay (CAP-16).** An epic-6 recording replays with the new names and sprites, with no projection error and no other change.
- **Dry run 3, checked by hand.**
  - The guard's deny still applies under `bypassPermissions`.
  - Every human prompt maps to exactly one ask in `review-policy.md`.

## Technical Decisions

- **AD-31 guard (7-1).**
  - The synchronous `PreToolUse` guard denies, in bound sessions only, any `Bash` call whose `tool_input.dangerouslyDisableSandbox` is `true`. This covers both the conductor and subagents.
  - The check runs before the path checks. When the flag is `false` or absent, the existing checks run unchanged. Unbound sessions are untouched.
  - The flag is already in the hook input. With no sandbox it does nothing, so denying it costs nothing.
  - The deny reason tells the model what to do: factory sessions run every command inside the sandbox (AD-35). Report the failure as it is, don't retry outside the sandbox, and don't ask the human to change sandbox or permission settings.
  - Like the rest of the guard, this is a tripwire against the model following default advice. It is not a boundary against someone running as the user.
- **AD-35 (7-1).**
  - The rule becomes its own bullet: "the sandbox is never bypassed".
  - Remove the inline "never bypasses the sandbox" clause from the setup bullet.
- **Prompt lines (7-1).**
  - The conductor skill gets a rule after "Never run git yourself". It forbids running outside the sandbox and suggesting sandbox or settings changes, says explicitly that this overrides Claude Code's default advice, and says to report a denial under the existing error rule.
  - Every agent brief, through the shared lines in `brief.ts`, carries: never set `dangerouslyDisableSandbox`, and report a sandbox block as your failure or escalation.
  - The README sandbox section adds: the factory never runs outside the sandbox or asks you to change it mid-run, and a sandbox-denial failure is a factory bug.
- **AD-23 projection (7-2).**
  - One additive field: `BoardCard.checks_running: Check[]`. It lists the card's `run_check` steps that are issued and not yet verified. It is display only.
- **AD-32 (7-2).** No event change. Roles and check ids keep the same strings in events. Names are a display lookup through the existing `displayName`/`ROSTER`.
- **Stage to role for `agentsAt` (7-2).**
  - RECON→recon, FRAME→framer, SCAFFOLD→scaffolder, SPEC→spec-writer, SLICE PLAN→slicer. DESIGN keeps the designer.
  - The conductor appears only in the Swimlane header and at the stages it runs itself (INTAKE, WRAP).
- **Which checks get droids.**
  - Only checks that become `run_check` steps: `contract.install`, `contract.health`, `contract.test`, `spec.lint` and `plan.lint`.
  - `git.baseline`, `git.worktree_clean`, `git.deps`, `git.merged` and `devserver` appear only as evidence rows and keep their check names.

## UX & Interaction Patterns

- **New characters (7-2).** These are 16×16 two-frame placeholders from the shared sprite palette.

  | Short name | Role | Look | Role color | Signature |
  |---|---|---|---|---|
  | `Nyra` | recon | Hooded scout | olive `#b8c25e` | 3-frame scanner cone |
  | `Halden` | framer | Shipwright with a blueprint roll | olive (shared with recon) | Blueprint unrolls and rolls, 1.4 s |
  | `Orla` | scaffolder | Dockmaster | orchid `#d68ae6` | Hand lamp blinks |
  | `Ione` | spec-writer | Magistrate with a charter tablet | periwinkle `#8ea2ff` | Tablet lines appear, 1.2 s |
  | `Sorel` | slicer | Tactician at a holo-map | peach `#f2c7a0` | Markers blink into slots |

  - Recon and framer share olive because they fill the same stage slot and never both run in one lane. If UX wants one color per role, framer's alternative is bone `#e9dcc4`.
  - Full names (Pathfinder Nyra Kest and so on) appear only in the roster table. Everywhere else uses the short name.
- **Check droids (7-2).**
  - One shared chassis: a small box body on treads, one round photoreceptor and a status light.

    | Short name | Check | Role label |
    |---|---|---|
    | `Crate` | `contract.install` | `install check` |
    | `Pulse` | `contract.health` | `health check` |
    | `Gauge` | `contract.test` | `test check` |
    | `Margin` | `spec.lint` | `spec lint` |
    | `Tally` | `plan.lint` | `plan lint` |

  - Droids have no role color. Their dot is a 6 px outlined square (1 px `text-2`), and it never means state.
  - The status light blinks in `sprite-holo` while the check runs and shows frame 1 when idle. This is decoration only: pass or fail shows only in the claim chip.
  - Droids stand beside the card's agent (or alone) at agent scale, and leave when their check is verified.
  - Pell stays the only protocol droid.
- **Where names show.**
  - Claim rows, verdict rows and the Evidence drawer use the droid or character name.
  - The `waiting on` gloss from 6-3 keeps check role labels (`waiting on health, test`).
- **Rules that still apply.**
  - DESIGN hard rule: no Star Wars names, species or likenesses. Every new name must pass it, and any name can be renamed in review.
  - Every new color avoids the state hues and their neighbours (gold/sand, cyan, red-orange/copper/coral, amber) and meets 3:1 non-text contrast on `space-2`.
  - Sprites are `aria-hidden`; the name and role label are real text.
  - Effects stop under reduced motion.

## Cross-Story Dependencies

- **7-1 goes first.** It changes how dry run 3 behaves when a command fails. 7-1 and 7-2 are otherwise independent.
- **7-1 amends 1-3 (guard), 1-2 (conductor skill) and every brief.** 7-2 amends 2-2 (sprites, roster, claim rows, drawer), the stages owned by 1-4, 3-2, 3-3 and 5-2, and the 6-3 gloss.
- **7-2 contract edits.**
  - DESIGN gains five role tokens, five roster rows and a new Check droids subsection.
  - EXPERIENCE gets new stage-lifecycle "Path on board" lines and a Voice and Tone rule.
  - Remove the spine's deviation row "agents without a roster character → shown as the conductor".
