---
name: d2t-factory dashboard
status: final
updated: 2026-10-23
sources:
  - ../../../specs/spec-poc-factory-plugin/SPEC.md
  - ../../../specs/spec-poc-factory-plugin/pipeline-stages.md
  - ../../../specs/spec-poc-factory-plugin/review-policy.md
  - ../../../specs/spec-poc-factory-plugin/truth-layer.md
  - mockups/key-dashboard.html
  - mockups/key-wrap.html
design: DESIGN.md
---

# d2t-factory dashboard — Experience Spine

## Foundation

| Aspect | Decision |
|---|---|
| Primary surface | Local, read-only web dashboard (JSONL → SQLite → SSE, `truth-layer.md`). A window, not a cockpit (SPEC Non-goals). |
| Form factor | Desktop browser, local machine, dark only. Shown on a shared screen in interviews. |
| Responsive & platform | Desktop only, designed at ≥1440px; below that the board keeps its column widths and scrolls horizontally; no mobile or touch layout (`DESIGN.md` Layout & Spacing). |
| Secondary surface | Claude Code chat: `/factory` commands, gate and escalation messages, resume list. Chat renders through Claude Code's own renderer: plain text and inline code, no custom formatting assumed. See Chat surfaces (Information Architecture). |
| Out of scope here | Human-read markdown files (`spec.md`, `design.md`, slice plan, verdict files, WRAP summary) follow formats in `pipeline-stages.md`. The spec's `design.md` output and its reviewer-ux, reviewer-ui and reviewer-a11y reviewers govern apps the factory *builds*, not this UI. |
| Users | d2t, the single operator (protagonist). The interviewer, a secondary viewer of the shared screen. |
| UI stack | None named in sources. Plain HTML/CSS + minimal JS fed by SSE; no component framework required. |
| Visual reference | `DESIGN.md` owns looks; this spine owns behavior. |
| Spec inheritance | Serves CAP-1 to CAP-8 and CAP-10 to CAP-16 by reference. Requirements are not restated here. |
| Vocabulary | "Seal" always means a **Decision seal** (a human decision). The gold claim state is a **VERIFIED chip**, never a seal. `BUILD` is the board label for the spec's BUILD LOOP. |

→ Composition reference: `mockups/key-dashboard.html` (replay mode, two lanes, Evidence drawer, Replay bar, States section). If the mock conflicts with this spine or `DESIGN.md`, the spine or `DESIGN.md` wins; `DESIGN.md` lists the known mock deviations.

→ Composition reference: `mockups/key-wrap.html` (live mode, lane `r-7f3a` at WRAP with merge ready; States: Done deck seal row, conflicted MERGE, Decision drawer for an escalation ruling).

## Inspiration & Anti-patterns

| | Source | Taken or rejected | Why |
|---|---|---|---|
| Lifted | Old Republic-era games (KOTOR, SWTOR) — **in spirit only** | War-table framing, robed masters, naval officers, holo-tech, a pixel cast | Charm on a shared screen; d2t as the robed master makes "the human outranks the agents" visible |
| Lifted | agents-observe (`truth-layer.md`, `prior-art.md`) — **patterns, not code** | Hook events → local server → SQLite → live browser view | Hook-observed facts are the board's only source of truth |
| Rejected | ZazenCodes polling `dashboard.html` (`prior-art.md`) | Polling page; backlog + `/factory next` | The board pushes live over SSE (CAP-15) and marks every claim claimed vs verified; Backlog holds only this run's slices (SPEC Non-goals) |
| Rejected | "Cockpit" (SPEC Non-goals) | Dashboard controls that drive a run | Read-only window; driving from the terminal *is* the demo. The Action slot only reserves room for a future button |
| Rejected | Actual Star Wars IP | Names, species, likenesses, logos, ships, catchphrases | A portfolio piece shown in interviews; original cast only (`DESIGN.md` Do's and Don'ts) |
| Rejected | SaaS admin panel | Neutral tables, sidebars, gray chrome | No charm, and it buries the human queue |
| Rejected | Light mode, modal dialogs, toasts that hide cards | — | Dark-only POC; nothing may cover the board |

## Information Architecture

### Board

| Region | Content | Notes |
|---|---|---|
| Top bar | Brand, Mode badge, Truth legend, Reduce-motion toggle | Always visible; sticky. |
| Column headers | `Backlog` · `In Progress` · `In Review` · `NEEDS YOU` · `Done`, each with a board-wide count | Needs You header holds the Master d2t seat. Sticky on vertical scroll, so the seat is always on screen. |
| Swimlanes | One per run, stacked vertically; Swimlane header + one row of five cells | All runs across worktrees (CAP-15). Order: most recently started run on top. Swimlane headers scroll with their lane. |
| Evidence drawer | Docked right; board narrows | Closed by default. |
| Replay bar | Sticky bottom | Replay mode only. |

### Columns

| Column | Holds |
|---|---|
| Backlog | Slice cards queued from the approved slice plan *within this run* (not a cross-project backlog — SPEC Non-goals). |
| In Progress | The stage or slice an agent is working now. |
| In Review | Slice cards under review by their reviewer roster (`review-policy.md`); reviewers cluster around the card. Slices with queued findings wait here. |
| Needs You | Everything that needs d2t: planned gates and the four escalation conditions, plus SCAFFOLD failure, cut, merge and lost-contact cards. |
| Done | Completed stage and slice cards with their seals; overflow follows the Done stack rule (Component Patterns). |

### Card kinds

| Kind | Represents |
|---|---|
| Stage card | A pipeline phase (INTAKE … WRAP); drawn as a holo-plate |
| Slice card | One slice from the slice plan; drawn as a datapad |
| Needs You card | A decision waiting on d2t |

### Stage lifecycle

| Stage (`pipeline-stages.md`) | Card(s) | Path on board | Human decision |
|---|---|---|---|
| INTAKE | Stage card `INTAKE` | In Progress (Master d2t attached) → Done | Seal `intake confirmed · Master d2t`; timeline pip. No Needs You card — d2t is already in the conversation. Slice time box set here (default 30 min, CAP-2). |
| RECON / FRAME | Stage card `RECON` or `FRAME` | In Progress → Done | None. No sprite on the card; the conductor in the Swimlane header owns this stage. Origin tag `brownfield` or `greenfield` (CAP-3). |
| SCAFFOLD | Stage card `SCAFFOLD` | In Progress → Done | On failure the card moves to Needs You tagged `ESCALATION`, reason label `Scaffold failed:` (CAP-4; see Open items). |
| SPEC ∥ DESIGN | Stage cards `SPEC` and `DESIGN` (DESIGN omitted when the app has no UI surface or INTAKE marked the task UI-free) | Both In Progress in parallel (Sela Venn on DESIGN) → merge into one Needs You card (GATE) `Gate 1 — Spec + Design ready` → both to Done | Seal `Gate 1 · approved by Master d2t` on each (CAP-5, CAP-6). Sela Venn stands by beside the Needs You card (GATE). Not approved → rework (Cross-stage events). |
| SLICE PLAN | Stage card `SLICE PLAN` | In Progress → Needs You card (GATE, Gate 2) → Done | Seal `Gate 2 · approved by Master d2t` (CAP-7). On approval slice cards are dealt into Backlog. Not approved → rework (Cross-stage events). |
| BUILD LOOP (board label `BUILD`) | Slice cards `S1…Sn` | Backlog → In Progress (Brix, Time box meter) → In Review (roster, Verdict list) → Done (`VERIFIED`) | Findings send the card back to In Progress; meta shows `round n/2` (max 2, CAP-8). An escalation moves the slice card itself into Needs You tagged `ESCALATION` with its reason label; d2t's ruling seals the slice `escalation ruled · Master d2t`. Independent slices pipeline: S*n* in review while S*n+1* is in progress. |
| WRAP | Stage card `WRAP` | In Progress → Needs You card (MERGE) → Done | Seal `merge OK · Master d2t` (CAP-13). Card content and waiting state: Merge waiting and Conflicted merge (State Patterns). |

### Cross-stage events

| Event | Card(s) | Path on board | Human decision |
|---|---|---|---|
| Pipelined findings (CAP-8) | Slice card S*n* | Stays in In Review marked `findings queued` while Brix finishes S*n+1*'s implementation → In Progress (fix) → In Review, where only the reviewer who raised the finding re-checks → then S*n+1* goes to review | A bounce past `round 2/2` escalates as `Non-convergence:`. |
| Budget clock (limit − 40m) | Needs You card (CUT) | Appears in Needs You; remaining Backlog cards get the AT RISK edge | d2t's cut choice is sealed (CAP-11). Cut slices move to Done as **cut** (seal `cut · Master d2t`, no Claim chip); kept slices lose AT RISK and stay in Backlog. |
| `/factory rework <note>` — rejected gate | Needs You card (GATE) + the stage card(s) sent back | Needs You card (GATE) leaves Needs You; SPEC and/or DESIGN (Gate 1) or SLICE PLAN (Gate 2) return to In Progress; the gate diamond reverts to hollow | Seal `rework · Master d2t` on each card sent back + timeline pip. The gate is re-raised as a new Needs You card (GATE) when the stage finishes. Flow 4. |
| `/factory rework <note>` — slice | The slice card | Returns to In Progress, then In Review with its full roster | Seal `rework · Master d2t`. A human rework is not a findings round: `round n/2` does not advance. |

### Needs You type tags

| Tag | Source |
|---|---|
| `GATE` | Gate 1, Gate 2 (CAP-5/6/7) |
| `ESCALATION` | One of the four conditions in `review-policy.md`, or SCAFFOLD failure; reason label below |
| `CUT` | Budget clock cut point (CAP-11) |
| `MERGE` | WRAP merge OK (CAP-13) |
| `SIGNAL LOST` | Liveness: missed heartbeats (`truth-layer.md`) |

Every tag shows the same command: `/factory resume <run-id>`. Within a lane, Needs You cards are sorted by raised time, oldest first.

### Escalation reason labels

Every `ESCALATION` card's REASON block starts with exactly one bold label from this table, followed by a one-line explanation. The chat message reuses label and explanation verbatim.

| Label | Condition (`review-policy.md` Human escalation) | Example REASON line |
|---|---|---|
| `Scope change:` | 1 — Scope/intent change | `Scope change: export must include archived orders — not in the spec.` |
| `Spec ambiguity:` | 1 — Spec ambiguity that forks the code | `Spec ambiguity: "date range" could mean order date or ship date — two different queries.` |
| `Irreversible action:` | 2 — Irreversible or outward action: migrations, deleting code outside the slice, secrets / network / deploy | `Irreversible action: S3 adds a migration to the orders table.` |
| `New dependency:` | 2 — New dependencies (brownfield only) | `New dependency: Brix wants to add csv-stringify to the repo.` |
| `Non-convergence:` | 3 — Same finding bounced twice | `Non-convergence: Tarvus's null-filter finding bounced twice (round 2/2).` |
| `Over time box:` | 3 — Slice over its time box | `Over time box: S4 at 34 / 30 min.` |
| `Taste disagreement:` | 4 — Builder/reviewer taste disagreement | `Taste disagreement: Brix vs Quill — ISO date vs locale date in filename` |
| `Scaffold failed:` | SCAFFOLD "page on failure" (CAP-4) — not one of the four; see Open items | `Scaffold failed: npm test exits 1 on a clean install (3 failing suites).` |

### Modes

| | Live | Replay (CAP-16) |
|---|---|---|
| Entry | `127.0.0.1:<port>/` | `127.0.0.1:<port>/replay/<recording>` (mock: `127.0.0.1:4317/replay/2026-10-22`). Port: see Open items. |
| Mode badge | `LIVE` (`OFFLINE · reconnecting` on SSE loss) | `REPLAY · recorded <date>` (`REPLAY · loading` while loading; `REPLAY` when the recording is not found) |
| Data | SSE stream, no reload (CAP-15) | Recorded, redacted session |
| Replay bar | Hidden | Visible |
| Concurrency | One live run in interviews (SPEC Constraints) | Multi-run lanes shown here only |

### Chat surfaces (Claude Code)

| Surface | Behavior |
|---|---|
| `/factory [task]` | Starts a run; a new swimlane appears with `INTAKE` in progress. |
| `/factory` | Resumes from disk (CAP-1). With several live runs in the main checkout, it prints the resume list and asks which run to resume. With no live runs, it starts INTAKE and asks for the task. |
| `/factory resume <run-id>` | Explicit resume. This is the command on every Needs You card. |
| `/factory rework <note>` | Sends work back; see the two rework events in Cross-stage events. Not approving a gate is a rework. |
| Second run refused (CAP-12) | Printed in chat; no swimlane appears: `Run refused — r-7f3a is live in this repo and its run contract lists a shared database. One run per repo.` A second claim on a live run id: `Run r-7f3a is already claimed by another session.` |
| Gate / escalation message | Carries the **same title, type tag, reason label, and command** as its dashboard card. Shape (lines separated by /): `[GATE] Gate 1 — Spec + Design ready` / reason or checks / `/factory resume r-2c91`. |
| Resume list | One row per live run: run id · title · stage · slice · last activity (`pipeline-stages.md`). Same vocabulary as the Swimlane header (`r-7f3a · Add CSV export to Orders page · BUILD · S3 · 2m ago`). |

## Voice and Tone

Microcopy. Brand posture lives in `DESIGN.md`. Terse, precise, spec vocabulary verbatim; light in-world flavor, never at the cost of clarity.

| Do | Don't |
|---|---|
| `NEEDS YOU` | "Escalated" (the spec reserves *escalation* for the four conditions) |
| `RESPOND IN TERMINAL` + `/factory resume r-7f3a` | "Click to resolve" (the board is read-only) |
| `Taste disagreement: Brix vs Quill — ISO date vs locale date in filename` | "Agents disagree about something" |
| `Cut point reached — 2 slices unbuilt. Cut S5, S6?` | "⚠ You're running out of time!" |
| `No heartbeat from the builder for 4m (3 missed).` | "Something went wrong" |
| `A hook fact matched Brix's claim.` | "Verified by AI ✓" |
| `Gate 2 · approved by Master d2t` | "Approved" (unattributed) |
| `Slices are dealt here once the slice plan clears Gate 2.` | "Nothing here yet!" |
| `Master d2t · you`, `standing by`, `SIGNAL LOST` — flavor on top of meaning | In-world-only phrasing that hides meaning ("The Council awaits") |
| Name + role label together: `Brix` / `builder` | A character name without its role |

Rules:

- State words are uppercase: `CLAIMED`, `VERIFIED`, `UNVERIFIED`, `AT RISK`, `CUT`.
- Reason labels come from the reason-label table and lead in bold.
- Characters use their display (short) name everywhere — `Quill`, `Tarvus`, `Pell`, `Adm. Vess Korrin` (`DESIGN.md` Character roster).
- Each time names the event it measures: `raised 14:36`, `last seen 4m ago`, `1:12 left of 2:00`.
- No exclamation marks, no emoji.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md` Components (same names).

| Component | Use | Behavioral rules |
|---|---|---|
| Top bar | Every view | Static, sticky. Holds mode, legend, toggle. |
| Mode badge | Top bar | Reflects mode; values per the Modes table. Never interactive. |
| Truth legend | Top bar | Always visible in both modes; three entries, fixed order CLAIMED · VERIFIED · UNVERIFIED. |
| Reduce-motion toggle | Top bar | Native checkbox semantics. When checked, it turns off animation even if the OS allows motion. Remembered per browser; OS `prefers-reduced-motion` forces it on. |
| Column header | Board top | Counts sum all lanes; update live. Sticky on vertical scroll. |
| Needs You column | Board | Gold tint spans all lanes. Master d2t's sprite looks up when a Needs You card enters, and periodically while idle. |
| Swimlane header | Each run | Shows run id, title, origin tag (`brownfield`/`greenfield`, always shown), current stage (gold when waiting on d2t), Budget clock, Stage track. |
| Budget clock | Swimlane header | Counts down from the stated limit; bar drains leftward; cut marker fixed at limit − 40m (CAP-11). Past 0:00 shows `+m:ss over` in `{colors.amber}`. |
| Stage track | Swimlane header | One step per pipeline stage + gate diamonds. Waiting gate reads `GATE n · NEEDS YOU`; a gate sent back by rework reverts to hollow. Not interactive. |
| Stage card | Cells | One per stage; moves columns per Stage lifecycle. Seals accumulate on it. |
| Slice card | Cells | Moves Backlog → In Progress → In Review → Done; back to In Progress on findings (meta `round n/2`); to Needs You on escalation. Pipelined findings: waits in In Review marked `findings queued` (Cross-stage events). Live spine lights while an agent works it. |
| Time box meter | Slice card (In Progress) | Elapsed / slice time box (set at INTAKE). Exceeding the time box is escalation condition 3: the card moves to Needs You with `Over time box:`. |
| Verdict list | Slice card (In Review) | One row per rostered reviewer; each verdict carries its own Claim chip. Verdict word rules below. Card movement follows the state machine, never the word. |
| Claim chip | Slice cards, verdict rows, Evidence drawer (Decision) evidence rows | Any agent claim renders CLAIMED until a hook fact or evidence check confirms it (→ VERIFIED) or it is overdue (→ UNVERIFIED). Clicking opens the Evidence drawer (Claim). Needs You card (GATE) checks are plain text for d2t to check, not chips. |
| Decision seal | Any card a human decision touched | Created on every gate, cut, merge, rework, escalation ruling, intake confirm. Never removed or hidden; when its card collapses into the Done deck, the seal moves to the deck's seal row. Clicking opens the Evidence drawer (Decision). |
| Needs You card | Needs You column | Enters with beacon; leaves when the state machine records the decision; a seal stays on the affected card. |
| Type tag | Needs You card | One of `GATE`, `ESCALATION`, `CUT`, `MERGE`, `SIGNAL LOST`. |
| Action slot | Needs You card | Shows the exact command + Copy button. Reserved footprint for a future action button. No other control. |
| Agent sprite | Cells, headers | Each agent is at one card at a time; several agents may share a card (review cluster). Idle agents stand by beside the relevant card. Lost agents dissolve to static. Decorative; name + role are text. |
| Done stack | Done cells | **Canonical rule.** Newest first; beyond 5 items, the 4 newest stay visible and the rest collapse into a `+N` deck naming them. The deck carries a seal row: one gold glyph per seal on its collapsed cards, each a focusable button that opens the Evidence drawer (Decision); its accessible name is the seal line. While a glyph's drawer is open, that glyph is the selected source (gold outline) and the deck carries `EVIDENCE ▸`. The deck itself is not expandable in the POC; no seal is ever unreachable. → mock: `mockups/key-wrap.html` States 01. |
| Empty cell | Any cell with a pending reason | Shows why it's empty and what fills it (`AWAITING GATE 1`). Idle cells with no pending reason stay blank. |
| Evidence drawer | Right dock | Two variants (table below). Source card gets outline + `EVIDENCE ▸`. One at a time; clicking another chip or seal swaps content. Close via `×` or `Esc`, in both modes. → mock: `mockups/key-wrap.html` drawer (Gate 2) and States 03 (escalation). |
| Replay bar | Replay mode | Play/pause, speed, prev/next decision, timeline. Board state always equals the event log at the playhead. |
| Starfield | Backdrop | Ambient only; stops under reduced motion. |

**Evidence drawer variants.**

| Variant | Opened from | Title | Rows | Chain |
|---|---|---|---|---|
| Claim | Claim chip | `DESIGN.md` Evidence drawer | Proof table; for a CLAIMED or UNVERIFIED claim it reads `none yet` (CLAIMED) or `no hook fact` (UNVERIFIED) | Claim → proof chain; for CLAIMED or UNVERIFIED it stops at the cyan node |
| Decision | Decision seal or deck seal glyph | `Decision · <Event> · <run-id>` | event (the state-machine event name; see Open items) · reason (ESCALATION decisions only: reason label + line, verbatim from the card) · decided by · at · terminal response · run / stage · evidence checked | None |

**Verdict words.** The first line of each verdict file is `VERDICT`, `STATUS`, or `APPROVE|ESCALATE` (`pipeline-stages.md` Agent protocol). Colors in `DESIGN.md` Verdict list.

| First line | Shown |
|---|---|
| `APPROVE` | `APPROVE` |
| `ESCALATE` | `ESCALATE` (the slice also moves to Needs You with its reason label) |
| `VERDICT …` / `STATUS …` / anything else | The value verbatim, truncated to 14 characters; the full line is the accessible name |
| No file yet | `reviewing…`, no chip |

## State Patterns

### Claim truth

| State | Surface | Treatment |
|---|---|---|
| CLAIMED | Claim chip | Agent reported it; no hook fact or evidence check yet. Cyan hologram, flicker, text `CLAIMED`. |
| VERIFIED | Claim chip | A hook fact or evidence check confirmed it (`truth-layer.md`). One-time scan-line sweep, then a solid gold VERIFIED chip, text `VERIFIED` + gloss. |
| UNVERIFIED | Claim chip | Claim overdue with no hook fact (CAP-15). Red-orange flicker, `UNVERIFIED · no hook fact`. "Overdue" window: 30s after the claim, to be tuned at the dry run (Open items). |

### Lanes and runs

| State | Surface | Treatment |
|---|---|---|
| SIGNAL LOST | Slice/stage card + Needs You | Sprite dissolves to static; card shows the SIGNAL LOST variant (`SIGNAL LOST · last seen 4m ago`); a `SIGNAL LOST` card (`Run lost contact`) appears in Needs You with `/factory resume <run-id>`. Threshold: 3 missed heartbeats, to be tuned at the dry run. Clears when heartbeats resume. Dashboard-only notice: never pages d2t in chat, so CAP-10's interrupt list stays intact. |
| Run abandoned | Swimlane | A run that never resumes keeps its SIGNAL LOST card and card variant; `last seen` keeps counting (`last seen 2d ago`). No auto-removal or archive in the POC (Future). |
| Run complete | Swimlane | Lane stays, all cards in Done, stage track fully lit with MERGE diamond solid; no auto-removal in the POC. |
| Findings queued | In Review | Slice card shows `findings queued` until its builder is free; meta shows `round n/2`. |
| Reviewer not rostered yet | In Review cell | Agent stands alone, label `standing by` (mock: Kael Nox). |
| Empty Backlog before Gate 2 | Backlog cell | Empty cell `AWAITING GATE 1` or `AWAITING GATE 2` (whichever gate is pending) + `Slices are dealt here once the slice plan clears Gate 2.` |

### Gates, budget and merge

| State | Surface | Treatment |
|---|---|---|
| Gate waiting | Stage track + Swimlane header + Needs You | Track shows `GATE n · NEEDS YOU`; header stage reads `GATE n` in gold; Needs You card (GATE). |
| Gate sent back | Stage track + cells | Rework of a rejected gate (Cross-stage events): Needs You card (GATE) gone, stage card(s) back in In Progress with `rework · Master d2t`, gate diamond hollow, header stage shows the reworked stage. |
| Budget running | Budget clock | Holo bar drains leftward toward the gold cut marker. |
| Cut point reached | Needs You + Backlog | Needs You card (CUT) `Cut point reached — N slices unbuilt. Cut S5, S6?`; every remaining Backlog card shows the AT RISK variant (`AT RISK · cut candidate`). |
| Slice cut | Done | Cut variant: `CUT` tag, seal `cut · Master d2t`, no Claim chip. |
| Merge waiting | Needs You + Swimlane header + Stage track | Needs You card (MERGE) titled `Merge ready — <run title>`; body shows `<branch> → main`, then the re-verified tests and Tarvus's reviewer-code verdict (each VERIFIED). The lane header reads `STAGE MERGE`; the track shows `MERGE · NEEDS YOU` with WRAP done. → mock: `mockups/key-wrap.html`. |
| Conflicted merge | Needs You card (MERGE) | A `RESOLUTIONS` block sits above the re-verified rows. → mock: `mockups/key-wrap.html` States 02. |

### Board

| State | Surface | Treatment |
|---|---|---|
| Cold load | Board | Top bar + column headers render immediately; lanes appear as the SQLite snapshot arrives; no spinners, no skeleton cards. |
| No runs | Board | Empty board with Master d2t seated; centered Empty cell: `NO RUNS YET` / `Start one in the terminal:` + `/factory [task]` styled as an Action slot. |
| Dashboard server disconnected | Top bar + board | Mode badge `OFFLINE · reconnecting`; board freezes at last known state and dims to 90% opacity (`DESIGN.md` Mode badge); on reconnect it resyncs from SQLite without reload. Not styled as danger (no agent fault implied). |

### Replay

| State | Surface | Treatment |
|---|---|---|
| Replay loading | Top bar + board + Replay bar | Mode badge `REPLAY · loading`; Top bar and column headers render; lanes appear when the recording is parsed; Replay bar shows with controls disabled. No spinner. |
| Recording not found | Board | Missing recording or malformed `/replay/<recording>` URL: Mode badge `REPLAY`; centered Empty cell `RECORDING NOT FOUND` / `No recording named <recording> on this machine.` + link `Open the live board` (`/`). Replay bar hidden. |
| Replay opened | Replay bar | Paused at `00:00:00`; board shows the log at that instant. No autoplay — d2t starts it. |
| Seek with drawer open | Evidence drawer | Drawer content reflects the playhead (a claim may revert to CLAIMED). If its source card or seal does not exist at the playhead, the drawer closes and focus moves to the timeline. |
| Replay ended | Replay bar | Pauses at the last event; play restarts from `00:00:00`. |

### Controls

| State | Surface | Treatment |
|---|---|---|
| Copy failed | Action slot | Clipboard denied or unavailable: the command text in its field is selected, the glyph does not change, and `Copy failed — command selected` is announced. |

→ mock: `mockups/key-dashboard.html` States section (01 claim states · 02 SIGNAL LOST · 03 budget CUT · 04 reduced motion · 05 Done entry).

## Interaction Primitives

- **Read-only.** No control changes run state (SPEC Non-goals). The only actions: copy a command, open or close evidence, use the replay controls, toggle reduced motion, and follow the `Open the live board` link.
- **Copy command** — clicking Copy in an Action slot copies the command text exactly (no `$ `). Success: glyph swaps to a check for 1.5s and `Copied` is announced. Failure: see Copy failed (State Patterns).
- **Evidence drawer** — click any Claim chip, Decision seal or deck seal glyph to open; `×` closes; focus moves into the drawer on open and returns to the source on close.
- **Replay controls** — play/pause; speed `1×` / `4×` / `16×` (radio group); `prev decision` / `next decision` jump the playhead to the previous/next gold pip (human decision) and pause there; timeline shows played portion, pips, playhead. Click/drag on the timeline seeks.
- **Live updates** — SSE pushes events; the board updates without reload (CAP-15). State changes apply instantly; animation follows.
- **Keyboard shortcuts:** `Esc` closes the drawer (both modes). Replay mode only: `Space` play/pause, `←`/`→` prev/next decision. Shortcuts never fire while focus is on a button, checkbox, radio, link or other native control — native activation and arrow-key movement win (for example, `←`/`→` move within the speed radio group).
- **Banned:** drag and drop, inline edits, any button that writes to the truth layer, modal dialogs, toasts that hide cards.

## Motion

Motion is the "wow"; it only decorates state changes. Visual specifics in `DESIGN.md`.

### Rules

1. State is never animated into existence: it updates instantly, and animation is decorative only.
2. Event-triggered animations (travel, entry, sweep) last ≤600ms.
3. Ambient loops (starfield, flicker, beacon, idles, sheen) are exempt from the 600ms cap but stay low-amplitude, on 1–160s cycles.
4. Bursts coalesce: when several events hit one card or agent in quick succession, animate once to the final state. Coalescing window 250ms, to be tuned at the dry run (Open items).
5. At `16×` replay, travel animations (card glide, agent walk) are skipped — items jump. At `1×` and `4×`, event animations play at normal duration, not scaled.
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
| Needs You entry | Holo-beacon ring pulse (loops while waiting) + Master d2t looks up | 2.6s loop | Solid 2px gold border, no pulse; Master d2t's look-up pose is held (static), not removed |
| Done entry | Hyperspace streak in, then settle (once per entry) | ≤600ms | Instant |
| Claim verified | Scan-line sweep, then solid gold | ≤600ms | Instant gold |
| CLAIMED / UNVERIFIED / SIGNAL LOST | Irregular flicker | 3.2s / 2.2s / 1.8s loops | Steady |
| VERIFIED chip | White sheen sweep | 6s loop | None |
| Current stage / waiting gate | Glow pulse + square blink / diamond fill blink | 2.4s / 1.4s | Steady |
| Type tag lamp, reviewing ellipsis | Step blink | 1–1.2s | Steady |
| Agent lost | Sprite dissolves to rolling static | 1.6s loop | Static frame |

## Accessibility Floor

Behavioral. Contrast and minimum sizes live in `DESIGN.md`.

- `prefers-reduced-motion` honored; the Top bar toggle provides the same for anyone. Needs You stays distinguishable via solid gold border.
- Every state has a text label, never color alone: `CLAIMED`, `VERIFIED`, `UNVERIFIED`, `SIGNAL LOST`, `AT RISK`, `CUT`, `findings queued`, type tags, `GATE n · NEEDS YOU`. VERIFIED chips include the word `VERIFIED`, visibly or in their accessible name, even when the visible gloss is `tests pass`.
- Sprites and pixel glyphs are `aria-hidden`; character name and role label are real text. Deck seal glyphs are the exception: each is a button named by its seal line.
- Keyboard: Copy buttons, Claim chips, Decision seals, deck seal glyphs, drawer close, replay buttons, speed radio group, and the toggle are all reachable by `Tab` in reading order (top bar → lanes left-to-right → drawer → replay bar) with a visible `{colors.holo}` 2px focus ring. Shortcut rules in Interaction Primitives.
- Landmarks: each swimlane is a labeled region (`Run r-7f3a`); drawer and replay bar are labeled (`Evidence drawer`, `Replay controls`).
- New Needs You cards are announced politely via `aria-live`: `<TYPE>: <title>, run <id>`. Announcements within 1s coalesce into one (to be tuned at the dry run; Open items). At `16×` replay they are suppressed while playing; on pause one summary is announced (`Needs You: 3 cards`).
- Copy buttons have the accessible name `Copy command`; their announcements are defined in Copy command (Interaction Primitives) and Copy failed (State Patterns).

## Key Flows

All four flows are derived from the pipeline; validate them at the dry run.

### Flow 1 — Live interview run, brief → merge OK (d2t driving, interviewer watching)

1. d2t types `/factory add CSV export to Orders page` in Claude Code. A new swimlane appears; `INTAKE` in progress with Master d2t attached.
2. Intake brainstorm in chat; d2t confirms. INTAKE lands in Done with `intake confirmed · Master d2t`.
3. RECON and SCAFFOLD run and stack into Done; Budget clock starts draining.
4. SPEC and DESIGN work in parallel; they merge into a Needs You card (GATE) — `Gate 1 — Spec + Design ready`, `3 assumptions to check`. The chat shows the same title and tag. d2t approves in the terminal; both cards drop into Done with gold seals.
5. SLICE PLAN → Gate 2 → approved. Slice cards are dealt into Backlog. Done now holds six cards, so the two oldest collapse into the deck — and their seals move to its seal row, still clickable.
6. Brix takes S1; it moves to In Review; reviewers cluster; chips go CLAIMED → VERIFIED; S1 streaks into Done.
7. While S2 is in review, Brix and Quill disagree on S4's filename format. S4 moves into Needs You tagged `ESCALATION`, reason `Taste disagreement: …`, command `/factory resume r-7f3a`.
8. **Climax:** the beacon pulses, Master d2t looks up, the interviewer sees the human queue light gold. d2t rules in the terminal. The Needs You card (ESCALATION) leaves and the seal `escalation ruled · Master d2t` appears on S4 — the human decision is on the record. Clicking the seal opens the Decision drawer with the reason row (→ mock: `mockups/key-wrap.html` States 03).
9. Remaining slices finish; WRAP → Needs You card (MERGE) `Merge ready — Add CSV export to Orders page`, lane header `STAGE MERGE` in gold (→ mock: `mockups/key-wrap.html`); d2t gives merge OK; seal; lane complete.

Failures:
- **Cut point reached** with slices unbuilt → Needs You card (CUT), AT RISK on Backlog; d2t cuts in the terminal; cut slices go to Done with `cut · Master d2t`, kept slices lose AT RISK and get built; the run proceeds to WRAP (Cross-stage events: Budget clock).
- **Conflicted merge** → WRAP resolves and re-verifies; the Needs You card (MERGE) body lists the resolutions, passing tests and Tarvus's verdict before d2t's OK (Conflicted merge in State Patterns, CAP-13; → mock: `mockups/key-wrap.html` States 02).
- **Any other escalation** → same path as steps 7–8, with that condition's reason label.

### Flow 2 — Replay for the interviewer (two concurrent lanes)

Also the fallback when a live demo stalls: d2t switches to replay and continues the story from the recording.

1. d2t opens `127.0.0.1:<port>/replay/2026-10-22`; badge reads `REPLAY · loading`, then `REPLAY · recorded 2026-10-22`; the playhead waits at `00:00:00`.
2. d2t presses play. Two lanes: `r-7f3a` in BUILD, `r-2c91` waiting at Gate 1 — concurrency the live demo never shows (SPEC Constraints).
3. d2t presses `next decision`; the playhead jumps to the next gold pip and pauses. Speed `16×` skips travel animations to cover ground fast.
4. d2t points at S1 in Done and clicks its VERIFIED chip.
5. **Climax:** the Evidence drawer docks (Claim variant): `npm test -- orders/export`, exit code `0`, `Claimed by Brix 14:02:09 → verified by hook 14:02:11`. *"Agents can claim. Only a hook fact or an evidence check can verify."* — d2t explains the truth layer unaided (SPEC Success signal).
6. d2t presses `Esc` to close the drawer and resumes play.

Failure: **recording not found** (missing or mistyped name) → `RECORDING NOT FOUND` state; d2t follows `Open the live board` or retypes the URL.

### Flow 3 — Recovery after SIGNAL LOST (d2t, mid-interview, after a panicked `/clear`)

1. Mid-BUILD, Brix's session stops heartbeating (or d2t hits `/clear`).
2. After the threshold, Brix dissolves to static; S2 shows `SIGNAL LOST · last seen 4m ago`.
3. A `SIGNAL LOST` card appears in Needs You: `Run lost contact` / `No heartbeat from the builder for 4m (3 missed).` / `/factory resume r-9d02`.
4. d2t copies the command and runs it (or runs bare `/factory` inside the worktree).
5. **Climax:** heartbeats resume, the sprite rematerializes, the SIGNAL LOST card clears, and S2 picks up at the same stage and slice — no completed work redone (CAP-1).

Failure: several live runs in the main checkout → `/factory` prints the resume list; d2t picks the run id shown on the card. Never resumed → Run abandoned (State Patterns).

### Flow 4 — Gate sent back with rework (d2t at Gate 1)

1. The Needs You card (GATE) `Gate 1 — Spec + Design ready` shows `3 assumptions to check`.
2. d2t spots a hidden product decision in the spec's Assumptions and types `/factory rework AC-3 must cover archived orders`.
3. The Needs You card (GATE) leaves Needs You; SPEC returns to In Progress with `rework · Master d2t`; a gold pip lands on the timeline; the Gate 1 diamond reverts to hollow and the header stage reads `SPEC`.
4. SPEC finishes; a new Needs You card (GATE) is raised with a fresh `raised` time; the chat shows the same title and tag.
5. **Climax:** d2t approves; SPEC carries both seals — `rework · Master d2t` and `Gate 1 · approved by Master d2t` — so the send-back and the pass are both on the record.

Failure: Gate 2 sent back → the same path with SLICE PLAN. A slice sent back → it returns to In Progress, then In Review with its full roster; `round n/2` does not advance.

## Future & Open items

### Future

- **Actions from the dashboard** — the Action slot is reserved for a button that replaces the copied command. Spec-change candidate (SPEC Non-goal: read-only window); needs a truth-layer write path and local CSRF protection.
- **Light mode** — out of scope for the POC.
- **Final sprite art** — 32×32, 4-frame idle + walk, produced by a separate image-generation project to `DESIGN.md` sprite rules; sprite-holding columns widen then.
- **Lane archive** — removing or archiving completed and abandoned lanes; expandable Done deck.

### Open items (tracked)

| Item | Owner | Status |
|---|---|---|
| SCAFFOLD failure pages the human (CAP-4, `pipeline-stages.md` "Page on failure"), but CAP-10 allows interrupts only at planned gates and the four escalation conditions. The board shows it as `ESCALATION` / `Scaffold failed:`. Spec fix: add SCAFFOLD failure to CAP-10's list, or name it a planned gate. | Spec | Open |
| Verdict first-line vocabulary (`VERDICT`, `STATUS`, `APPROVE\|ESCALATE`) doesn't say which agent writes which form. The Verdict list renders the word verbatim meanwhile. | Spec | Open |
| Heartbeat interval and SIGNAL LOST threshold; the `4m (3 missed)` copy is illustrative. | Architecture | To be tuned at the dry run |
| Claim overdue window (CLAIMED → UNVERIFIED): 30s after the claim. | Architecture | To be tuned at the dry run |
| Motion coalescing window: 250ms. | UX | To be tuned at the dry run |
| `aria-live` announcement coalescing window: 1s. | UX | To be tuned at the dry run |
| Dashboard port (avoid 4317, the OpenTelemetry default). | Architecture | Open |
| State-machine event names shown in the Decision drawer `event` row; mock names (`gate_2_approved`, `escalation_ruled`) are placeholders. | Architecture | Open |
