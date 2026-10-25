# Validation Report — d2t-factory

- **DESIGN.md:** `/Users/d2t/Projects/d2t-factory/_bmad-output/planning-artifacts/ux-designs/ux-d2t-factory-2026-10-23/DESIGN.md`
- **EXPERIENCE.md:** `/Users/d2t/Projects/d2t-factory/_bmad-output/planning-artifacts/ux-designs/ux-d2t-factory-2026-10-23/EXPERIENCE.md`
- **Run at:** 2026-10-23T16:00:00

## Overall verdict

The pair is a usable contract: every `{token}` reference resolves, all 83 color tokens carry hex, the 24 components have matching rows in both files under identical names, and the board's lifecycle, modes and core states are committed in tables a story-dev can lift directly. The gaps are a few decisions left open that sit right on the product's thesis ("foreground human decisions"). The Done-stack collapse hides Decision seals, against the spine's own never-hide rule. The Evidence drawer has no content defined for a Decision seal. Escalation reason labels exist for only one of the four conditions. Fix those three, plus a cluster of medium consistency issues (amber's job, the "seal" naming overlap, the keyboard-shortcut conflicts, the incomplete CAP list), and the pair is strong.

## Category verdicts

- Flow coverage — adequate
- Token completeness — adequate
- Component coverage — adequate
- State coverage — adequate
- Visual reference coverage — adequate
- Bloat & overspecification — strong
- Inheritance discipline — adequate
- Shape fit — adequate

## Findings by severity

### Critical (0)

None.

### High (3)

**[Flow coverage]** — Escalation reason labels committed for only 1 of 4 conditions (§ EXPERIENCE L67, L80, L116, L125, L144)
Only one of the four escalation conditions has a committed reason label (`Taste disagreement:`). Conditions 1–3 from `review-policy.md` have none: scope/intent change or spec ambiguity, irreversible/outward action (including the brownfield-only new-dependency page), and non-convergence or a slice over its time box. The SCAFFOLD-failure ESCALATION reason is also unnamed. Voice rules require the card and the chat message to reuse these strings verbatim, so story-dev will invent up to five labels.
Fix: add a reason-label table: `Scope change:` / `Spec ambiguity:` / `Irreversible action:` / `New dependency:` / `Non-convergence:` / `Over time box:` / `Taste disagreement:` / `Scaffold failed:`, each with one example body line.

**[State coverage]** — Done-stack collapse hides Decision seals (§ DESIGN L473, L515; EXPERIENCE L147, L152)
Done-stack collapse hides Decision seals, against the spine's hard rule. The deck is "not expandable in the POC" (EXPERIENCE L152) and "Seals stay visible on visible cards" (DESIGN L473). That conflicts with "Never removed" (EXPERIENCE L147) and the Don't "Fade, collapse away, or hide a seal when a card ages" (DESIGN L515). In Flow 1, Done holds six stage cards before any slice lands, so the `intake confirmed` and both Gate 1 seals collapse out of sight. The approved mock already does this with INTAKE. This cuts against CAP-15 "human-attributed events" and SPEC "every surface foregrounds human decisions".
Fix: exempt sealed cards from collapse (collapse only unsealed machine stages), or render each collapsed seal as a clickable gold glyph on the deck.

**[State coverage]** — Evidence drawer content for a Decision seal undefined (§ DESIGN L475; EXPERIENCE L147, L154, L182)
Evidence drawer content for a Decision seal is undefined. Clicking any Decision seal opens the drawer (EXPERIENCE L147, L154, L182). However, the drawer spec, hero copy and HOOK FACT / CLAIM → PROOF anatomy describe only a claim being verified (DESIGN §Evidence drawer L475; EXPERIENCE L154). Nothing says what a gate, cut, merge, rework or intake seal shows: who, when, what was typed, the state-machine event, or gate evidence (CAP-14).
Fix: add a "Decision" drawer variant. Hero: seal + decision line. Table: event · decided by · at · terminal response · run / stage · evidence checked. No claim chain.

### Medium (14)

**[Flow coverage]** — No flow for rework or gate rejection (§ EXPERIENCE L73, L104; Key Flows)
`/factory rework <note>` (CAP-1) and gate rejection have no flow, only table rows. It is never shown what happens when d2t does not approve Gate 1/2, which card returns, whether the Gate card leaves Needs You, or whether reviewers re-run.
Fix: add a Flow 1 failure path or a short Flow 4: Gate 1 → d2t reworks the spec → SPEC returns to In Progress with `rework · Master d2t` → Gate 1 re-raised.

**[Token completeness]** — UNVERIFIED chip label measures 4.49:1 on its composited fill (§ DESIGN Contrast targets L396; YAML L54)
The UNVERIFIED chip contrast is stated as 5.3:1 (`danger` on fill), but that is `danger` on bare `card-top`. Compositing `danger-a` (`#ff6a3d24`) over `card-top` gives **4.49:1**. That is below the spine's own 4.5:1 text floor, on an 11px label for the one state that says "this claim is not proven".
Fix: measure against the composited fill. Either set the chip label to `danger-text` (8.3:1) or drop `danger-a` to `#ff6a3d1a` (4.75:1), then restate the ratio.

**[Token completeness]** — Amber has two jobs across the spines (§ DESIGN L376; EXPERIENCE L140)
Amber has two jobs across the spines. DESIGN says amber has "one job: the AT RISK edge" (DESIGN §Colors L376). EXPERIENCE also uses `{colors.amber}` for the Budget clock overrun `+m:ss over` (EXPERIENCE §Component Patterns L140), which has no component token and no measured contrast on `space-3` (7.45:1 computed).
Fix: add overrun to amber's job list, add `budget-clock.over: '{colors.amber}'`, and add the `amber` on `space-3` row.

**[Component coverage]** — Slice/Stage card state variants have no visual spec (§ DESIGN L460–461, YAML L261–274; EXPERIENCE L71, L165, L167)
Slice card and Stage card state variants are defined behaviorally but not visually. Missing: the AT RISK amber edge with label `AT RISK · cut candidate`; the SIGNAL LOST danger border with `SIGNAL LOST · last seen 4m ago`; the evidence-selected gold outline with the `EVIDENCE ▸` tab (it appears only inside the Evidence drawer bullet); a cut slice in Done. The YAML has no token for any of these.
Fix: add a "Variants" line to the Slice card and Stage card bullets, with tokens (`slice-card.at-risk-edge: '{colors.amber}'`, `slice-card.lost-border: '{colors.danger}'`, `slice-card.selected: '{colors.gold}'`).

**[Component coverage]** — Verdict list renders only APPROVE and reviewing (§ DESIGN L463; EXPERIENCE L145)
The Verdict list renders only `APPROVE` and `reviewing…`. The appearance of a findings verdict or an `ESCALATE` verdict is unspecified. The source's first-line vocabulary is itself ambiguous (`VERDICT`, `STATUS`, or `APPROVE|ESCALATE`, `pipeline-stages.md` Agent protocol), and the spine says "verbatim" without resolving it.
Fix: list the allowed verdict words and map each to an existing token. Keep gold off agent verdicts.

**[Component coverage]** — Sprite scale rule contradicts slot sizes (§ DESIGN L418, L456, L483, L487)
Sprite scale rules contradict their placements. The rule is "integer scale 2× / 3×", but the Master d2t seat is 128px (4× of 32, and the art is 32×30, not 32×32) and the conductor slot is 32px (1×). Column widths, notably In Review's 250px "four-sprite cluster", were sized on 48px placeholders while the final art is 64px.
Fix: state the allowed scales per slot (1× header, 2× board, 4× seat) and say which column widths grow at final art.

**[Component coverage]** — Mode badge OFFLINE variant and REPLAY dot unspecified (§ DESIGN L452; EXPERIENCE L175)
The Mode badge has no visual spec for `OFFLINE · reconnecting` or the 70% board dim, and the REPLAY dot color is unspecified (the mock uses `text-2`).
Fix: add an OFFLINE variant (dot `text-3`, no danger, no glow) and name the REPLAY dot token.

**[State coverage]** — Keyboard shortcuts conflict (Esc scope, Space, arrows) (§ EXPERIENCE L154, L182–186, L228)
Keyboard primitives conflict. `Esc` closes the drawer generally (L154, L182), but the keyboard list scopes `Esc` to "replay mode only" (L186). The global `Space` and `←/→` shortcuts collide with native activation of a focused Copy button or checkbox, and with arrow-key movement inside the speed radio group the spine itself mandates.
Fix: make `Esc` work in both modes, and suppress the replay shortcuts while focus is on a button, checkbox or radio.

**[State coverage]** — Replay entry states missing (§ EXPERIENCE Modes L91; State Patterns L176)
Replay entry states are missing: loading a recording, recording not found or a malformed `/replay/<recording>` URL, the initial playhead state (paused at 00:00:00 or autoplay), and what an open drawer does when the playhead seeks before its source event.
Fix: add four State Patterns rows.

**[State coverage]** — Pipelined-findings card placement undefined (§ EXPERIENCE L143, L151)
Placement of pipelined findings is undefined. When findings on S*n* arrive while Brix builds S*n+1* (`pipeline-stages.md` Agent protocol), the spine says the card goes "back to In Progress on findings" (L143), but the builder stays on S*n+1* and an agent works one card at a time (L151). Nothing says which column S*n* sits in, or how the retrigger round count (max 2, CAP-8) shows.
Fix: define a `findings queued` marker on S*n* in In Review and a `round n/2` meta line.

**[Inheritance discipline]** — Foundation CAP list incomplete (§ EXPERIENCE L27)
Foundation's CAP list ("Serves CAP-1, 5, 6, 7, 10, 11, 13, 15, 16", EXPERIENCE L27) omits CAPs the spine implements and in places cites: CAP-2 (time-box default, L144), CAP-3 (origin tag, L139), CAP-4 (SCAFFOLD failure, L67), CAP-8 (findings loop and pipelining, L70), CAP-12 (run id / worktrees, L39). Story-dev traceability breaks.
Fix: add CAP-2, 3, 4, 8 and 12.

**[Inheritance discipline]** — SCAFFOLD failure tagged ESCALATION, against spine vocabulary (§ EXPERIENCE L67, L114)
SCAFFOLD failure is tagged `ESCALATION` (L67), which contradicts the spine's own vocabulary rule that "the spec reserves *escalation* for the four conditions" (L114, `review-policy.md`). The user accepted this pending a spec fix, but the spine neither names the reason label nor tracks the spec change anywhere a consumer will see it.
Fix: name the label (`Scaffold failed:`) and add the CAP-4/CAP-10 spec-change item to §Future.

**[Inheritance discipline]** — "Seal" names both the VERIFIED chip and the Decision seal (§ EXPERIENCE L163, L256; DESIGN L466, L475)
"Seal" is overloaded. The VERIFIED Claim chip is called a "solid gold seal" or "pixel seal glyph" (EXPERIENCE L163; DESIGN L466, L475), and Flow 2 step 4 "clicks its VERIFIED seal" (L256). Meanwhile Decision seal is a separate component reserved for human decisions. A consumer can't tell which component Flow 2 exercises.
Fix: use "VERIFIED chip" everywhere and reserve "seal" for Decision seal. The glyph can be shared; the name should not be.

**[Shape fit]** — Inspiration & Anti-patterns triggered but absent (§ EXPERIENCE (absent); DESIGN L357, L364; EXPERIENCE L187, L274)
Inspiration & Anti-patterns is triggered but absent. The memlog names KOTOR/SWTOR as the inspiration, `truth-layer.md` borrows agents-observe patterns, and there are explicit rejects: cockpit/dashboard actions, SaaS admin panel, Star Wars IP, light mode, modals/toasts. These are scattered across DESIGN Brand (L357, L364), Interaction Primitives "Banned" (L187) and Future.
Fix: add a short EXPERIENCE section with what was lifted and what was rejected, and why.

### Low (19)

**[Flow coverage]** — CUT and conflicted-merge outcomes compressed to one line (§ EXPERIENCE L247, L249; L71–72)
The CUT (CAP-11) and conflicted-merge (CAP-13) outcomes are compressed into one line each. The lifecycle table carries the detail, but the flows don't exercise the kept-vs-cut split or the resolutions body.
Fix: add one step each, or point the failure line at the lifecycle rows.

**[Flow coverage]** — CAP-12 run refusal has no chat microcopy (§ EXPERIENCE Chat surfaces L97–106)
CAP-12 (second concurrent run refused when the run contract lists a shared DB; run-id claim fails) has no chat microcopy or flow.
Fix: add a chat-surface row with the refusal message.

**[Flow coverage]** — Flow 3 names no protagonist or context (§ EXPERIENCE L262)
Flow 3's heading names no protagonist or context, unlike Flows 1–2.
Fix: "(d2t, mid-interview, after a panicked `/clear`)".

**[Flow coverage]** — Replay flow has no real failure path (§ EXPERIENCE L260)
Flow 2's failure line ("live demo stalls → switch to replay") is the entry condition, not a failure of replay itself. Nothing covers a recording that is missing or fails to load.
Fix: add a `Recording not found` failure path that references the new state row (see §4).

**[Token completeness]** — Orphan color tokens (needs-text-sid, gold-a1, gold-2) (§ DESIGN YAML L40, L43, L51; L476)
Three color tokens are orphans: `needs-text-sid` (opaque name, used nowhere), `gold-a1` and `gold-2` are defined but never referenced in prose or components (DESIGN YAML L40, L43, L51). The future-pip "dim brown" (L476) may be `gold-2` but doesn't say so.
Fix: reference them where used (e.g. `replay-bar.pip-future: '{colors.gold-2}'`), and rename or delete `needs-text-sid`.

**[Token completeness]** — Shadows, glows, and hologram values are untokenized prose (§ DESIGN Elevation & Depth L430–433; Colors L377)
Shadows, glows, the inner highlight `rgba(255,255,255,.07)`, scan-line pitch, nebula opacities and the hologram treatment exist only as raw prose values (DESIGN §Elevation & Depth L430–433; §Colors L377). Implementers will hand-copy them, and they will drift.
Fix: add component-level tokens (e.g. `slice-card.shadow`, `needs-you-card.shadow`) or a single shadow table.

**[Token completeness]** — min-text font floor filed under spacing (§ DESIGN YAML L204; L414)
`min-text: 11px` lives under `spacing` but is a font-size floor.
Fix: express it as `{typography.tag.fontSize}`, or keep it as a note outside `spacing`.

**[Component coverage]** — Gate checks: Claim chips or plain text? (§ DESIGN L469; EXPERIENCE L146, L168)
EXPERIENCE says Claim chips appear on "Gate card checks" (L146). DESIGN's Needs You card shows checks as plain text (`3 assumptions to check`, L469). "Gate card" / "GATE card" is also used as if it were a component name.
Fix: decide whether gate checks carry chips, align both files, and write "Needs You card (GATE)".

**[State coverage]** — Abandoned run and sticky headers uncovered (§ EXPERIENCE IA L39; State Patterns)
There is no treatment for an abandoned or terminated run that never resumes. It is unstated whether the column headers and Master d2t seat stick when many lanes scroll vertically.
Fix: add a run-abandoned row and a sticky-header rule.

**[State coverage]** — Copy failure and aria-live burst at 16x uncovered (§ EXPERIENCE L181, L230)
Copy failure (clipboard denied) is not covered. At `16×` replay, `aria-live` Needs You announcements may burst.
Fix: fall back to selecting the command text, and coalesce or suppress announcements at 16×.

**[Visual reference coverage]** — Mock linked only at file tops (§ DESIGN L353; EXPERIENCE L29)
The mock is linked only at the top of each file, not at the sections it illustrates (Evidence drawer, Replay bar, Needs You card, the mock's States section vs EXPERIENCE State Patterns). DESIGN's link names nothing it illustrates.
Fix: add one-line `→ mock: <section>` pointers at those sections.

**[Visual reference coverage]** — Unlisted mock deltas (off-token CSS) (§ mockups/key-dashboard.html .mode)
Several mock deltas are unlisted: off-token values (Mode badge border `#4e5f97`, background `#141d42`, 12px text vs `tag` 11px), 2-frame placeholders, and no travel animation. "Spine wins" covers them, but an implementer reading the mock's CSS will copy them (mockups/key-dashboard.html `.mode`).
Fix: add a short "Mock deltas" note under the DESIGN link.

**[Visual reference coverage]** — Stale duplicate mock in .working/ (§ .working/)
`.working/key-dashboard.html` is a byte-identical copy of the mock, alongside pre-accept spine copies. They are easy to mistake for live references.
Fix: delete `.working/` or mark it scratch.

**[Bloat & overspecification]** — Done-stack rule stated four times (§ EXPERIENCE L51, L152, L171; DESIGN L473)
The Done-stack collapse rule is stated four times (EXPERIENCE IA L51, Component Patterns L152, State Patterns L171; DESIGN L473). The copies agree today, but this is where the §4 seal conflict hid.
Fix: the behavior lives in EXPERIENCE Component Patterns and the visual in DESIGN; the other two places point to them.

**[Bloat & overspecification]** — EXPERIENCE points at the memlog (§ EXPERIENCE L138)
EXPERIENCE points at the memlog ("memlog motion; idle 'look' is rendered", L138). Downstream consumers don't receive `.memlog.md`.
Fix: state the rule inline.

**[Bloat & overspecification]** — Prose restates YAML hex/px values (§ DESIGN L372–377, L418)
DESIGN Colors and Layout prose restate hex and px values already in YAML (L372–377, L418), so there are two places to edit.
Fix: in prose, name tokens and leave hex in YAML (optional; the editorial examples tolerate this).

**[Inheritance discipline]** — Verified narrowed to hook facts; evidence checks have no display path (§ DESIGN L453; EXPERIENCE L119)
The spec defines verified as "hook fact **or evidence check** confirms it" (`truth-layer.md` Principle). The spines narrow this to hook facts only (legend `VERIFIED hook fact confirms`, DESIGN L453; Voice L119). Gate-evidence checks (CAP-14) have no display path.
Fix: decide, then either widen the gloss or route evidence checks through the Decision-seal drawer (§4).

**[Inheritance discipline]** — BUILD vs BUILD LOOP; Quill vs Envoy Quill (§ DESIGN L459, L504; EXPERIENCE L70, L106, L116, L245)
Name drift. The spec's `BUILD LOOP` appears as `BUILD` in the Stage track, header and resume list (DESIGN L459; EXPERIENCE L106) and as `BUILD LOOP` in the lifecycle table (L70). DESIGN sets `Quill` as the short display name (L504), but microcopy uses `Envoy Quill`.
Fix: declare the display-name form per context (board label vs reason text) and note BUILD = BUILD LOOP once.

**[Shape fit]** — No Responsive & Platform note (§ DESIGN L424; EXPERIENCE Foundation)
There is no Responsive & Platform note. The desktop-only, horizontal-scroll behavior lives only in DESIGN Layout (L424), and the second surface (Claude Code chat) has no platform note.
Fix: add one line to Foundation pointing to DESIGN L424, and note that chat formatting follows Claude Code's renderer.

## Reviewer files

- `review-rubric.md`
