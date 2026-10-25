---
name: d2t-factory dashboard
status: draft
updated: 2026-10-23
sources:
  - ../../../specs/spec-poc-factory-plugin/SPEC.md
  - ../../../specs/spec-poc-factory-plugin/pipeline-stages.md
  - ../../../specs/spec-poc-factory-plugin/review-policy.md
  - ../../../specs/spec-poc-factory-plugin/truth-layer.md
  - mockups/key-dashboard.html
design: DESIGN.md
---

# d2t-factory dashboard — Experience Spine

## Foundation

| Aspect | Decision |
|---|---|
| Primary surface | Local, read-only web dashboard (JSONL → SQLite → SSE, `truth-layer.md`). A window, not a cockpit (SPEC Non-goals). |
| Form factor | Desktop browser, local machine, designed at 1440px, dark only. Shown on a shared screen in interviews. |
| Secondary surface | Claude Code chat: `/factory` commands, gate and escalation messages, resume list. Covered briefly below. |
| Out of scope here | Human-read markdown files (`spec.md`, `design.md`, slice plan, verdict files, WRAP summary) follow formats in `pipeline-stages.md`. The `design.md` and reviewer-ux/ui/a11y in the spec govern apps the factory *builds*, not this UI. |
| Users | d2t, the single operator (protagonist). The interviewer, a secondary viewer of the shared screen. |
| UI stack | None named in sources. [ASSUMPTION] Plain HTML/CSS + minimal JS fed by SSE; no component framework required. |
| Visual reference | `DESIGN.md` owns looks; this spine owns behavior. |
| Spec inheritance | Serves CAP-1, 5, 6, 7, 10, 11, 13, 15, 16 by reference. Requirements are not restated here. |

→ Composition reference: `mockups/key-dashboard.html` (replay mode, two lanes, evidence drawer, replay bar, States section). Spines win on conflict with the mock.

## Information Architecture

### Board

| Region | Content | Notes |
|---|---|---|
| Top bar | Brand, Mode badge, Truth legend, Reduce-motion toggle | Always visible. |
| Column headers | `Backlog` · `In Progress` · `In Review` · `NEEDS YOU` · `Done`, each with a board-wide count | Needs You header holds the Master d2t seat. |
| Swimlanes | One per run, stacked vertically; Swimlane header + one row of five cells | All runs across worktrees (CAP-15). [ASSUMPTION] Order: most recently started run on top. |
| Evidence drawer | Docked right, 320px; board narrows | Closed by default. |
| Replay bar | Sticky bottom | Replay mode only. |

### Columns

| Column | Holds |
|---|---|
| Backlog | Slice cards queued from the approved slice plan *within this run* (not a cross-project backlog — SPEC Non-goals). |
| In Progress | The stage or slice an agent is working now. |
| In Review | Slice cards under reviewer roster (`review-policy.md`); reviewers cluster around the card. |
| Needs You | Everything that needs d2t: planned gates and the four escalation conditions, plus cut, merge and lost-contact cards. |
| Done | Completed stage and slice cards with their seals; collapses into a stack beyond 5. |

### Card kinds

| Kind | Represents | Component |
|---|---|---|
| Stage card | A pipeline phase (INTAKE … WRAP) | Stage card (holo-plate) |
| Slice card | One slice from the slice plan | Slice card (datapad) |
| Needs You card | A decision waiting on d2t | Needs You card |

### Pipeline stage → card lifecycle

| Stage (`pipeline-stages.md`) | Card(s) | Path on board | Human decision |
|---|---|---|---|
| INTAKE | Stage card `INTAKE` | In Progress (Master d2t attached) → Done | Seal `intake confirmed · Master d2t`; timeline pip. [ASSUMPTION] No Needs You card — d2t is already in the conversation. |
| RECON / FRAME | Stage card `RECON` or `FRAME` | In Progress → Done | — [ASSUMPTION] No sprite attached; the conductor in the Swimlane header owns it. |
| SCAFFOLD | Stage card `SCAFFOLD` | In Progress → Done | On failure the card moves to Needs You tagged `ESCALATION` with the failed check as reason. [ASSUMPTION — spec says "page human" but lists no tag; see conflicts.] |
| SPEC ∥ DESIGN | Stage cards `SPEC` and `DESIGN` (DESIGN omitted when no UI surface or UI-free) | Both In Progress in parallel (Sela Venn on DESIGN) → merge into one `GATE` card `Gate 1 — Spec + Design ready` → both to Done | Seal `Gate 1 · approved by Master d2t` on each (CAP-5, CAP-6). Sela stands by beside the gate card. |
| SLICE PLAN | Stage card `SLICE PLAN` | In Progress → `GATE` card (Gate 2) → Done | Seal `Gate 2 · approved by Master d2t` (CAP-7). On approval slice cards are dealt into Backlog. |
| BUILD LOOP | Slice cards `S1…Sn` | Backlog → In Progress (Brix, Time box meter) → In Review (roster, Verdict list) → Done (`VERIFIED`) | Findings send the card back to In Progress. An escalation moves the slice card itself into Needs You tagged `ESCALATION` with its reason. Independent slices show pipelining: S*n* in review while S*n+1* is in progress. |
| Budget clock (limit − 40m) | `CUT` card | Appears in Needs You; remaining Backlog cards get the AT RISK edge | d2t's cut choice is sealed (CAP-11). [ASSUMPTION] Cut slices move to Done with seal `cut · Master d2t` and no Claim chip; kept slices lose AT RISK. |
| WRAP | Stage card `WRAP` | In Progress → `MERGE` card → Done | Seal on merge OK (CAP-13). [ASSUMPTION] Seal text `merge OK · Master d2t`; card title `Merge ready — <run title>`, body lists tests and reviewer-code verdict, plus resolutions when conflicted. |
| `/factory rework <note>` | The reworked card | Returns to In Progress | [ASSUMPTION] Seal `rework · Master d2t` on that card. |

### Needs You type tags

| Tag | Source | Command shown |
|---|---|---|
| `GATE` | Gate 1, Gate 2 (CAP-5/6/7) | `/factory resume <run-id>` |
| `ESCALATION` | One of the four conditions in `review-policy.md`; reason label names it (e.g. `Taste disagreement:`) | `/factory resume <run-id>` |
| `CUT` | Budget clock cut point (CAP-11) | `/factory resume <run-id>` |
| `MERGE` | WRAP merge OK (CAP-13) | `/factory resume <run-id>` |
| `SIGNAL LOST` | Liveness: missed heartbeats (`truth-layer.md`) | `/factory resume <run-id>` |

[ASSUMPTION] Needs You cards within a lane order oldest-raised first.

### Modes

| | Live | Replay (CAP-16) |
|---|---|---|
| Entry | [ASSUMPTION] `127.0.0.1:<port>/` | `127.0.0.1:<port>/replay/<recording>` (mock: `127.0.0.1:4317/replay/2026-10-22`) |
| Mode badge | [ASSUMPTION] `LIVE` | `REPLAY · recorded 2026-10-22` |
| Data | SSE stream, no reload (CAP-15) | Recorded, redacted session |
| Replay bar | Hidden | Visible |
| Concurrency | One live run in interviews (SPEC Constraints) | Multi-run lanes shown here only |

### Chat surfaces (Claude Code)

| Surface | Behavior |
|---|---|
| `/factory [task]` | Starts a run; a new swimlane appears with `INTAKE` in progress. |
| `/factory` | Resumes from disk per CAP-1; with several live runs in the main checkout, prints the resume list and asks. |
| `/factory resume <run-id>` | Explicit resume. This is the command on every Needs You card. |
| `/factory rework <note>` | Sends work back; card returns to In Progress. |
| Gate / escalation message | Carries the **same title, type tag, and command** as its dashboard card. [ASSUMPTION] Shape: `[GATE] Gate 1 — Spec + Design ready` / reason or checks / `/factory resume r-2c91`. |
| Resume list | One row per live run: run id · title · stage · slice · last activity (`pipeline-stages.md`). [ASSUMPTION] Same vocabulary as the Swimlane header (`r-7f3a · Add CSV export to Orders page · BUILD · S3 · 2m ago`). |

## Voice and Tone

Microcopy. Brand posture lives in `DESIGN.md`. Terse, precise, spec vocabulary verbatim; light in-world flavor never at the cost of clarity.

| Do | Don't |
|---|---|
| `NEEDS YOU` | "Escalated" (the spec reserves *escalation* for the four conditions) |
| `RESPOND IN TERMINAL` + `/factory resume r-7f3a` | "Click to resolve" (the board is read-only) |
| `Taste disagreement: Brix vs Envoy Quill — ISO date vs locale date in filename` | "Agents disagree about something" |
| `Cut point reached — 2 slices unbuilt. Cut S5, S6?` | "⚠ You're running out of time!" |
| `No heartbeat from the builder for 4m (3 missed).` | "Something went wrong" |
| `A hook fact matched Brix's claim.` | "Verified by AI ✓" |
| `Gate 2 · approved by Master d2t` | "Approved" (unattributed) |
| `Slices are dealt here once the slice plan clears Gate 2.` | "Nothing here yet!" |
| `Master d2t · you`, `standing by`, `SIGNAL LOST` — flavor on top of meaning | In-world-only phrasing that hides meaning ("The Council awaits") |
| Name + role label together: `Brix` / `builder` | A character name without its role |

Rules: state words are uppercase (`CLAIMED`, `VERIFIED`, `UNVERIFIED`, `AT RISK`); reason category leads in bold; times are relative to the decision (`raised 14:36`, `last seen 4m ago`, `1:12 left of 2:00`); no exclamation marks, no emoji; chat messages reuse the card's title, tag, and command verbatim.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md` Components (same names).

| Component | Use | Behavioral rules |
|---|---|---|
| Top bar | Every view | Static. Holds mode, legend, toggle. |
| Mode badge | Top bar | Reflects mode; never interactive. |
| Truth legend | Top bar | Always visible in both modes; three entries, fixed order CLAIMED · VERIFIED · UNVERIFIED. |
| Reduce-motion toggle | Top bar | Native checkbox semantics; on overrides animation even if OS allows motion. [ASSUMPTION] Remembered per browser; OS `prefers-reduced-motion` forces it on. |
| Column header | Board top | Counts sum all lanes; update live. |
| Needs You column | Board | Gold tint spans all lanes. Master d2t seat [ASSUMPTION] looks up when a card enters (memlog motion; idle "look" is rendered). |
| Swimlane header | Each run | Shows run id, title, origin tag (`brownfield`/`greenfield`, always shown), current stage (gold when waiting on d2t), Budget clock, Stage track. |
| Budget clock | Swimlane header | Counts down from the stated limit; bar drains leftward; cut marker fixed at limit − 40m (CAP-11). [ASSUMPTION] Past 0:00 shows `+m:ss over` in `{colors.amber}`. |
| Stage track | Swimlane header | One step per pipeline stage + gate diamonds. Waiting gate reads `GATE n · NEEDS YOU`. Not interactive. |
| Stage card | Cells | One per stage; moves columns per lifecycle table. Seals accumulate on it. |
| Slice card | Cells | Moves Backlog → In Progress → In Review → Done; back to In Progress on findings; to Needs You on escalation. Live spine lights while an agent works it. |
| Time box meter | Slice card (In Progress) | Elapsed / slice time box (default 30 min, CAP-2). Over time box is escalation condition 3 → card moves to Needs You. |
| Verdict list | Slice card (In Review) | One row per rostered reviewer; verdict word is the first line of that reviewer's verdict file, verbatim; each verdict carries its own Claim chip. |
| Claim chip | Slice cards, verdict rows, Gate card checks | Any agent claim renders CLAIMED until a hook fact matches (→ VERIFIED) or it is overdue (→ UNVERIFIED). Clicking opens the Evidence drawer. |
| Decision seal | Any card a human decision touched | Created on every gate, cut, merge, escalation ruling, intake confirm. Never removed. Clicking opens the Evidence drawer [ASSUMPTION — decision record view not mocked]. |
| Needs You card | Needs You column | Enters with beacon; leaves when the state machine records the decision, leaving a seal on the affected card. |
| Type tag | Needs You card | One of `GATE`, `ESCALATION`, `CUT`, `MERGE`, `SIGNAL LOST`. |
| Action slot | Needs You card | Shows the exact command + Copy button. Reserved footprint for a future action button. No other control. |
| Agent sprite | Cells, headers | One card per agent at a time; several agents may share one card (review cluster). Idle agents stand by beside the relevant card. Lost agents dissolve to static. Decorative; name + role are text. |
| Done stack | Done cells | Newest first; beyond 5 items, 4 stay visible and the rest collapse into a `+N` deck naming them. [ASSUMPTION] Deck is not expandable in the POC. |
| Empty cell | Any cell with a pending reason | Shows why it's empty and what fills it (`AWAITING GATE 1`). Idle cells with no pending reason stay blank. |
| Evidence drawer | Right dock | Opens from any Claim chip or Decision seal; source card gets outline + `EVIDENCE ▸`. One at a time; clicking another seal swaps content. Close via `×` or `Esc`. [ASSUMPTION] For CLAIMED/UNVERIFIED, HOOK FACT reads `none yet` / `no hook fact` and the chain stops at the cyan node. |
| Replay bar | Replay mode | Play/pause, speed, prev/next decision, timeline. Board state always equals the event log at the playhead. |
| Starfield | Backdrop | Ambient only; stops under reduced motion. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| CLAIMED | Claim chip | Agent reported it; no hook fact yet. Cyan hologram, flicker, text `CLAIMED`. |
| VERIFIED | Claim chip | Hook fact matched (`truth-layer.md`). One-time scan-line sweep, then solid gold seal, text `VERIFIED` + gloss. |
| UNVERIFIED | Claim chip | Claim overdue with no hook fact (CAP-15). Red-orange flicker, `UNVERIFIED · no hook fact`. [ASSUMPTION] "Overdue" window: 30s after the claim, tune at dry run. |
| SIGNAL LOST | Slice/stage card + Needs You | Sprite dissolves to static; card gets danger border and `SIGNAL LOST · last seen 4m ago`; a `SIGNAL LOST` card (`Run lost contact`) appears in Needs You with `/factory resume <run-id>`. Threshold [ASSUMPTION]: 3 missed heartbeats, tune at dry run. Clears when heartbeats resume. |
| Budget running | Budget clock | Holo bar drains leftward toward the gold cut marker. |
| Cut point reached | Needs You + Backlog | `CUT` card `Cut point reached — N slices unbuilt. Cut S5, S6?`; every remaining Backlog card gets the amber `AT RISK · cut candidate` edge. |
| Gate waiting | Stage track + Swimlane header + Needs You | Track shows `GATE n · NEEDS YOU`; header stage reads `GATE n` in gold; GATE card in Needs You. |
| Empty Backlog before Gate 2 | Backlog cell | Empty cell `AWAITING GATE 1` / `AWAITING GATE 2` [ASSUMPTION second string] + `Slices are dealt here once the slice plan clears Gate 2.` |
| Reviewer not rostered yet | In Review cell | Agent stands alone, label `standing by` (mock: Kael Nox). |
| Done overflow | Done cell | Collapse beyond 5 (see Done stack). |
| Run complete | Swimlane | [ASSUMPTION] Lane stays, all cards in Done, stage track fully lit with MERGE diamond solid; no auto-removal in the POC. |
| Cold load | Board | [ASSUMPTION] Top bar + column headers render immediately; lanes appear as the SQLite snapshot arrives; no spinners, no skeleton cards. |
| No runs | Board | [ASSUMPTION] Empty board with Master d2t seated; centered Empty cell: `NO RUNS YET` / `Start one in the terminal:` + `/factory [task]` in an Action slot style. |
| Dashboard server disconnected | Top bar + board | [ASSUMPTION] Mode badge reads `OFFLINE · reconnecting`; board freezes at last known state and dims to 70%; on reconnect it resyncs from SQLite without reload. Not styled as danger (no agent fault implied). |
| Replay ended | Replay bar | [ASSUMPTION] Pauses at the last event; play restarts from 00:00:00. |

## Interaction Primitives

- **Read-only.** No control changes run state (SPEC Non-goals). The only actions: copy a command, open/close evidence, replay controls, reduce motion.
- **Copy command** — click Copy in an Action slot copies the command text exactly (no `$ `). [ASSUMPTION] Feedback: glyph swaps to a check for 1.5s and `Copied` is announced.
- **Evidence drawer** — click any Claim chip or Decision seal to open; `×` or `Esc` closes; focus moves into the drawer on open and returns to the source on close.
- **Replay controls** — play/pause; speed `1×` / `4×` / `16×` (radio group); `prev decision` / `next decision` jump the playhead to the previous/next gold pip (human decision) and pause there; timeline shows played portion, pips, playhead. [ASSUMPTION] Click/drag on the timeline seeks.
- **Reduce motion** — header toggle or OS setting.
- **Live updates** — SSE pushes events; the board updates without reload (CAP-15). State changes apply instantly; animation follows.
- [ASSUMPTION] **Keyboard:** `Space` play/pause, `←`/`→` prev/next decision, `Esc` close drawer — in replay mode only.
- **Banned:** drag and drop, inline edits, any button that writes to the truth layer, modal dialogs, toasts that hide cards.

## Motion

Motion is the "wow," but **state is never animated into existence** — the board's state changes instantly and motion decorates the change. Visual specifics in `DESIGN.md`.

### Rules

1. State updates instantly; animation is decorative only.
2. Event-triggered animations (travel, entry, sweep) last ≤600ms.
3. [ASSUMPTION] Ambient loops (starfield, flicker, beacon, idles, sheen) are exempt from the 600ms cap but stay low-amplitude; the approved mock runs them at 1–160s cycles.
4. Bursts coalesce: when several events hit one card or agent in quick succession, animate once to the final state. [ASSUMPTION] Coalescing window 250ms.
5. At `16×` replay, travel animations (card glide, agent walk) are skipped — items jump. [ASSUMPTION] At `1×` and `4×`, event animations play at normal duration, not scaled.
6. Reduced motion (OS or toggle) removes all non-essential motion; state still changes instantly.

### Inventory

| Trigger | Motion | Duration | Reduced motion |
|---|---|---|---|
| Ambient | Three-layer parallax starfield drift | 50 / 90 / 160s loops | Static |
| Ambient | Master d2t halo rays rotate | 60s loop | Static |
| Ambient | Agent idles (2-frame placeholder → 4-frame final) + per-character effect | 0.22–3.4s | Stopped (frame 1) |
| Card moves column | Card glides to new cell | ≤600ms | Instant |
| Agent changes card | Agent walks (walk cycle) card to card | ≤600ms | Instant |
| Slice enters review | Reviewers walk in and cluster around the card | ≤600ms | Instant |
| Needs You entry | Holo-beacon ring pulse (loops while waiting) + Master d2t looks up | 2.6s loop | Solid 2px gold border, no pulse |
| Done entry | Hyperspace streak in, then settle (once per entry) | ≤600ms | Instant |
| Claim verified | Scan-line sweep, then solid gold | ≤600ms | Instant gold |
| CLAIMED / UNVERIFIED / SIGNAL LOST | Irregular flicker | 3.2s / 2.2s / 1.8s loops | Steady |
| VERIFIED chip | White sheen sweep | 6s loop | None |
| Current stage / waiting gate | Glow pulse + square blink / diamond fill blink | 2.4s / 1.4s | Steady |
| Type tag lamp, reviewing ellipsis | Step blink | 1–1.2s | Steady |
| Agent lost | Sprite dissolves to rolling static | 1.6s loop | Static frame |

## Accessibility Floor

Behavioral. Contrast and minimum sizes live in `DESIGN.md`.

- `prefers-reduced-motion` honored; header toggle provides the same for anyone. Needs You stays distinguishable via solid gold border.
- Every state has a text label, never color alone: `CLAIMED`, `VERIFIED`, `UNVERIFIED`, `SIGNAL LOST`, `AT RISK`, type tags, `GATE n · NEEDS YOU`. VERIFIED chips include the word `VERIFIED` (or an accessible name) even when the visible gloss is `tests pass`.
- Sprites and pixel glyphs are `aria-hidden`; character name and role label are real text.
- Keyboard: Copy buttons, Claim chips, Decision seals, drawer close, replay buttons, speed radio group, and the toggle are all reachable by `Tab` in reading order (top bar → lanes left-to-right → drawer → replay bar) with a visible `{colors.holo}` 2px focus ring.
- Landmarks: each swimlane is a labeled region (`Run r-7f3a`); drawer and replay bar are labeled (`Evidence drawer`, `Replay controls`).
- [ASSUMPTION] New Needs You cards are announced politely via `aria-live`: `<TYPE>: <title>, run <id>`.
- Copy buttons have accessible name `Copy command`.

## Key Flows

[ASSUMPTION — derived from pipeline, user to validate at dry run] for all three flows.

### Flow 1 — Live interview run, brief → merge OK (d2t driving, interviewer watching)

1. d2t types `/factory add CSV export to Orders page` in Claude Code. A new swimlane appears; `INTAKE` in progress with Master d2t attached.
2. Intake brainstorm in chat; d2t confirms. INTAKE lands in Done with `intake confirmed · Master d2t`.
3. RECON, SCAFFOLD run and stack into Done; Budget clock starts draining.
4. SPEC and DESIGN work in parallel; they merge into a `GATE` card in Needs You — `Gate 1 — Spec + Design ready`, `3 assumptions to check`. The chat shows the same title and tag. d2t approves in the terminal; both cards drop into Done with gold seals.
5. SLICE PLAN → Gate 2 → approved. Slice cards are dealt into Backlog.
6. Brix takes S1; it moves to In Review; reviewers cluster; chips go CLAIMED → VERIFIED; S1 streaks into Done.
7. While S2 is in review, Brix and Envoy Quill disagree on S4's filename format. S4 moves into Needs You tagged `ESCALATION`, reason `Taste disagreement: …`, command `/factory resume r-7f3a`.
8. **Climax:** the beacon pulses, Master d2t looks up, the interviewer sees the human queue light gold. d2t rules in the terminal; the ESCALATION card leaves and a gold seal appears on S4 — the human decision is on the record.
9. Remaining slices finish; WRAP → `MERGE` card; d2t gives merge OK; seal; lane complete.

Failure: budget cut point reached with slices unbuilt → `CUT` card, AT RISK edges on Backlog; d2t cuts in the terminal and the run proceeds to WRAP.

### Flow 2 — Replay for the interviewer (two concurrent lanes)

1. d2t opens `127.0.0.1:<port>/replay/2026-10-22`; badge reads `REPLAY · recorded 2026-10-22`.
2. Two lanes: `r-7f3a` in BUILD, `r-2c91` waiting at Gate 1 — concurrency the live demo never shows (SPEC Constraints).
3. d2t presses `next decision`; the playhead jumps to the next gold pip and pauses. Speed `16×` skips travel to cover ground fast.
4. d2t points at S1 in Done and clicks its VERIFIED seal.
5. **Climax:** the Evidence drawer docks: `npm test -- orders/export`, exit code `0`, `Claimed by Brix 14:02:09 → verified by hook 14:02:11`. *"Agents can claim. Only a hook fact can verify."* — d2t explains the truth layer unaided (SPEC Success signal).
6. `Esc` closes the drawer; play resumes.

Failure: live demo stalls → d2t switches to replay and continues the story from the recording.

### Flow 3 — Recovery: SIGNAL LOST / panicked `/clear`

1. Mid-BUILD, Brix's session stops heartbeating (or d2t hits `/clear`).
2. After the threshold, Brix dissolves to static; S2 shows `SIGNAL LOST · last seen 4m ago`.
3. A `SIGNAL LOST` card appears in Needs You: `Run lost contact` / `No heartbeat from the builder for 4m (3 missed).` / `/factory resume r-9d02`.
4. d2t copies the command and runs it (or bare `/factory` inside the worktree).
5. **Climax:** heartbeats resume, the sprite rematerializes, the SIGNAL LOST card clears, and S2 picks up at the same stage and slice — no completed work redone (CAP-1).

Failure: several live runs in the main checkout → `/factory` prints the resume list; d2t picks the run id shown on the card.

## Future

- **Actions from the dashboard** — the Action slot is reserved for a button that replaces the copied command. Spec-change candidate (SPEC Non-goal: read-only window); needs a truth-layer write path and local CSRF protection.
- **Light mode** — out of scope for the POC.
- **Final sprite art** — 32×32, 4-frame idle + walk, produced by a separate image-generation project to `DESIGN.md` sprite rules.
