---
name: d2t-factory dashboard
description: Read-only local board that shows every factory run as a swimlane of cards worked by original Old Republic-spirited pixel characters, with d2t's decisions in gold and every agent claim marked claimed or verified. Dark only.
status: final
updated: 2026-10-23
sources:
  - ../../../specs/spec-poc-factory-plugin/SPEC.md
  - ../../../specs/spec-poc-factory-plugin/pipeline-stages.md
  - ../../../specs/spec-poc-factory-plugin/review-policy.md
  - ../../../specs/spec-poc-factory-plugin/truth-layer.md
  - mockups/key-dashboard.html
  - mockups/key-wrap.html
colors:
  # Space: tonal layers, darkest first
  space-0: '#04060f'
  space-1: '#070c1d'
  space-2: '#0d1530'
  space-3: '#142048'
  card-top: '#17234d'
  card-bottom: '#0e1738'
  card-edge: '#2e3d73'
  line: '#26345f'
  line-strong: '#33427a'
  nebula-violet: '#785aff'
  # Ink
  text: '#eaf2ff'
  text-2: '#b4c2e0'
  text-3: '#8a9bc2'
  # Holo: agents + CLAIMED
  holo: '#5ee7ff'
  holo-2: '#1f8fb8'
  holo-text: '#bff4ff'
  holo-text-2: '#9edff0'
  holo-text-3: '#c9f7ff'
  on-holo: '#04121a'
  holo-a1: '#5ee7ff14'
  holo-a2: '#5ee7ff38'
  holo-a3: '#5ee7ff80'
  # Republic gold: everything d2t
  gold: '#f6c64a'
  gold-2: '#b07f22'
  gold-hi: '#ffe08a'
  gold-ink: '#1a1204'
  gold-a1: '#f6c64a12'
  gold-a2: '#f6c64a33'
  gold-a3: '#f6c64a8c'
  needs-surface-top: '#362a10'
  needs-surface-bottom: '#0f1121'
  needs-text: '#fff6dd'
  needs-text-2: '#e9dcc0'
  needs-text-3: '#d8c48e'
  needs-chip-ink: '#f3dfa8'
  needs-wash-top: '#f6c64a21'
  needs-wash-bottom: '#f6c64a0d'
  needs-edge: '#f6c64a47'
  needs-card-edge: '#f6c64abf'
  # Danger only
  danger: '#ff6a3d'
  danger-a: '#ff6a3d24'
  danger-text: '#ffc2ad'
  on-danger: '#1d0700'
  # Amber: budget pressure (AT RISK edge, clock overrun)
  amber: '#ff9a2e'
  amber-text: '#ffd2a1'
  # Role colors (role dot + sprite accent; never state)
  role-d2t: '#f6c64a'
  role-builder: '#9aa6bf'
  role-designer: '#a487ff'
  role-reviewer-code: '#8cc084'
  role-reviewer-security: '#e5283f'
  role-reviewer-security-text: '#ff9aa7'
  role-reviewer-ux: '#ff8fb1'
  role-reviewer-a11y: '#dfe8f7'
  role-reviewer-ui: '#3fcfa6'
  role-recon: '#b8c25e'
  role-framer: '#b8c25e'
  role-scaffolder: '#d68ae6'
  role-spec-writer: '#8ea2ff'
  role-slicer: '#f2c7a0'
  # Shared sprite palette (16 core + 4 accents; light from top-left)
  sprite-void: '#0a0e1a'
  sprite-navy: '#1b2440'
  sprite-indigo: '#33427a'
  sprite-white: '#eef4ff'
  sprite-steel: '#9aa6bf'
  sprite-slate: '#5a6580'
  sprite-skin-light: '#f2c7a0'
  sprite-skin-mid: '#c38a64'
  sprite-brown: '#7a4e2c'
  sprite-brown-dark: '#4a2d18'
  sprite-gold: '#f6c64a'
  sprite-gold-dark: '#b07f22'
  sprite-holo: '#5ee7ff'
  sprite-holo-dark: '#1f8fb8'
  sprite-violet: '#a487ff'
  sprite-crimson: '#e5283f'
  sprite-teal: '#3fcfa6'
  sprite-pink: '#ff8fb1'
  sprite-sage: '#8cc084'
  sprite-moss: '#4f7a4a'
typography:
  brand:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: 19px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: -0.01em
  lane-title:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: 16px
    fontWeight: '700'
    lineHeight: '1.2'
  needs-title:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: 15px
    fontWeight: '700'
    lineHeight: '1.3'
  card-title:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1.3'
  body:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.45'
  body-sm:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.45'
  label:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.2'
  column-title:
    fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.14em
  needs-column-title:
    fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: 14px
    fontWeight: '800'
    lineHeight: '1'
    letterSpacing: 0.18em
  tag:
    fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: 11px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.08em
  meta:
    fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: 11px
    fontWeight: '400'
    lineHeight: '1.4'
  data:
    fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.3'
  command:
    fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: 13px
    fontWeight: '600'
    lineHeight: '1'
  readout:
    fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: 15px
    fontWeight: '700'
    lineHeight: '1'
  readout-lg:
    fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: 17px
    fontWeight: '700'
    lineHeight: '1'
rounded:
  xs: 2px
  sm: 3px
  md: 4px
  DEFAULT: 6px
  inset: 7px
  lg: 8px
  xl: 10px
  2xl: 14px
  full: 9999px
spacing:
  '1': 4px
  '2': 6px
  '3': 8px
  '4': 10px
  '5': 12px
  '6': 14px
  '7': 16px
  '8': 18px
  '9': 20px
  board-gutter: 16px
  column-gap: 10px
  card-gap: 10px
  lane-gap: 18px
  topbar-height: 64px
  replay-height: 86px
  drawer-width: 320px
  viewport-target: 1440px
  col-backlog: 160px
  col-in-progress: 196px
  col-in-review: 250px
  col-needs-you: 272px
  col-done: 170px
components:
  top-bar:
    background: '{colors.space-2}'
    border: '{colors.holo-a2}'
    height: '{spacing.topbar-height}'
    title: '{typography.brand}'
  mode-badge:
    background: '{colors.space-3}'
    border: '{colors.line-strong}'
    foreground: '{colors.text}'
    detail: '{colors.text-2}'
    dot-live: '{colors.holo}'
    dot-replay: '{colors.text-2}'
    dot-offline: '{colors.text-3}'
    type: '{typography.tag}'
    radius: '{rounded.DEFAULT}'
  truth-legend:
    background: '{colors.space-1}'
    border: '{colors.line}'
    radius: '{rounded.lg}'
  reduce-motion-toggle:
    track: '{colors.space-3}'
    track-on: '{colors.holo-2}'
    focus-ring: '{colors.holo}'
    type: '{typography.label}'
  column-header:
    foreground: '{colors.text-2}'
    rule: '{colors.line}'
    type: '{typography.column-title}'
    count-pill-radius: '{rounded.full}'
  needs-you-column:
    tint: '{colors.needs-wash-top}'
    tint-bottom: '{colors.needs-wash-bottom}'
    edge: '{colors.needs-edge}'
    title: '{colors.gold}'
    title-type: '{typography.needs-column-title}'
    count-pill: '{colors.gold}'
    count-pill-ink: '{colors.gold-ink}'
    seat-sub: '{colors.needs-chip-ink}'
    radius-foot: '{rounded.2xl}'
    width: '{spacing.col-needs-you}'
  swimlane-header:
    background: '{colors.space-3}'
    border: '{colors.holo-a2}'
    title: '{typography.lane-title}'
    run-id-type: '{typography.tag}'
    radius: '{rounded.xl}'
  budget-clock:
    value: '{typography.readout}'
    fill: '{colors.holo}'
    fill-shade: '{colors.holo-2}'
    track: '{colors.space-1}'
    cut-marker: '{colors.gold}'
    over: '{colors.amber}'
    radius: '{rounded.xs}'
  stage-track:
    step-done: '{colors.holo-text-2}'
    step-now: '{colors.holo}'
    step-now-ink: '{colors.on-holo}'
    step-future: '{colors.text-3}'
    gate: '{colors.gold}'
    gate-wait-ink: '{colors.gold-ink}'
    type: '{typography.tag}'
    radius: '{rounded.sm}'
  stage-card:
    tint: '{colors.holo-a1}'
    border: '{colors.holo-a3}'
    title: '{colors.holo-text}'
    type: '{typography.column-title}'
    lost-border: '{colors.danger}'
    selected: '{colors.gold}'
    radius: '{rounded.DEFAULT}'
  slice-card:
    background-top: '{colors.card-top}'
    background-bottom: '{colors.card-bottom}'
    border: '{colors.card-edge}'
    spine-live: '{colors.holo}'
    title: '{typography.card-title}'
    id-chip-type: '{typography.tag}'
    queued: '{colors.holo-text}'
    at-risk-edge: '{colors.amber}'
    at-risk-label: '{colors.amber}'
    at-risk-detail: '{colors.amber-text}'
    lost-border: '{colors.danger}'
    lost-label: '{colors.danger}'
    lost-detail: '{colors.danger-text}'
    selected: '{colors.gold}'
    selected-tab-ink: '{colors.gold-ink}'
    cut-tag: '{colors.text-3}'
    cut-spine: '{colors.line-strong}'
    radius: '{rounded.lg}'
  time-box-meter:
    fill: '{colors.holo}'
    track: '{colors.space-1}'
    type: '{typography.meta}'
  verdict-list:
    rule: '{colors.line}'
    name: '{colors.text-2}'
    verdict: '{typography.tag}'
    approve: '{colors.text}'
    escalate: '{colors.text}'
    other: '{colors.holo-text}'
    pending: '{colors.text-3}'
  claim-chip:
    claimed: '{colors.holo}'
    claimed-gloss: '{colors.holo-text-3}'
    verified: '{colors.gold}'
    verified-top: '{colors.gold-hi}'
    verified-ink: '{colors.gold-ink}'
    unverified: '{colors.danger}'
    unverified-label: '{colors.danger-text}'
    unverified-fill: '{colors.danger-a}'
    type: '{typography.tag}'
    radius: '{rounded.md}'
  decision-seal:
    foreground: '{colors.gold}'
    type: '{typography.tag}'
  needs-you-card:
    background-top: '{colors.needs-surface-top}'
    background-bottom: '{colors.needs-surface-bottom}'
    border: '{colors.needs-card-edge}'
    title: '{colors.needs-text}'
    title-type: '{typography.needs-title}'
    body: '{colors.needs-text-2}'
    label: '{colors.needs-text-3}'
    id-chip-ink: '{colors.needs-chip-ink}'
    radius: '{rounded.xl}'
  type-tag:
    background: '{colors.gold}'
    foreground: '{colors.gold-ink}'
    background-danger: '{colors.danger}'
    foreground-danger: '{colors.on-danger}'
    type: '{typography.tag}'
    radius: '{rounded.sm}'
  action-slot:
    border: '{colors.gold-a3}'
    label: '{colors.gold}'
    command-bg: '{colors.space-0}'
    command-type: '{typography.command}'
    radius: '{rounded.inset}'
  agent-sprite:
    name: '{typography.label}'
    role: '{typography.meta}'
    role-ink: '{colors.holo}'
    role-ink-security: '{colors.role-reviewer-security-text}'
    pad-glow: '{colors.holo-a3}'
  done-stack:
    deck-border: '{colors.holo-a2}'
    deck-count: '{colors.holo-text}'
    seal-glyph: '{colors.gold}'
    seal-hover: '{colors.space-3}'
    seal-selected: '{colors.gold}'
    seal-focus: '{colors.holo}'
    type: '{typography.meta}'
  empty-cell:
    border: '{colors.holo-a2}'
    title: '{colors.holo-text-2}'
    body: '{colors.text-3}'
    radius: '{rounded.lg}'
  evidence-drawer:
    background: '{colors.space-2}'
    edge: '{colors.gold}'
    hero-tint: '{colors.gold-a1}'
    width: '{spacing.drawer-width}'
    fact-type: '{typography.data}'
    radius-fact: '{rounded.inset}'
  replay-bar:
    background: '{colors.space-2}'
    height: '{spacing.replay-height}'
    speed-on: '{colors.holo}'
    speed-on-ink: '{colors.on-holo}'
    pip: '{colors.gold}'
    pip-future: '{colors.gold-2}'
    playhead: '{colors.holo}'
    time: '{typography.readout-lg}'
  starfield:
    base: '{colors.space-1}'
    nebula-gold: '{colors.gold}'
    nebula-violet: '{colors.nebula-violet}'
    nebula-holo: '{colors.holo}'
---

# d2t-factory dashboard — Design Spine

→ Visual references. Section-level pointers below read `→ mock:` followed by the mock and the region.

| Mock | Status | Shows |
|---|---|---|
| `mockups/key-dashboard.html` | Approved in full, 2026-10-23 | The board in replay mode with two lanes, the Evidence drawer, the Replay bar, and a States section (01 claim states · 02 SIGNAL LOST · 03 budget CUT · 04 reduced motion · 05 Done entry) |
| `mockups/key-wrap.html` | 2026-10-23 | Lane `r-7f3a` in live mode at WRAP, merge ready: the Needs You card (MERGE), the Stage track waiting on MERGE, the Done deck seal row, and the Evidence drawer (Decision, Gate 2), plus States (01 Done deck seal row · 02 MERGE, conflicted merge · 03 Decision drawer, escalation ruling) |

This spine wins on conflict with either mock; the known deviations are listed in Components → Mock deviations — spine wins.

## Brand & Style

The dashboard is a war table aboard an Old Republic flagship, not a SaaS admin panel. A dark starfield drifts behind a five-column board; each factory run is a swimlane commanded by its conductor; small pixel-art characters walk from card to card doing the work. It is built to be watched on a shared screen during an interview, so it has to be charming at a glance and exact on inspection.

Two ideas govern every pixel:

1. **The human outranks the agents.** d2t appears as *Master d2t*, the largest sprite on the board, seated above the Needs You column under a slow gold halo. Everything d2t decides — gates, cuts, merges, reworks, escalation rulings — is gold and leaves a gold Decision seal that never fades or hides, even in Done. Agents glow cyan; d2t glows gold. (SPEC Constraint: every surface foregrounds human decisions; CAP-15.)
2. **Agents claim; the truth layer verifies.** An agent's say-so is a flickering cyan hologram. Only a hook fact or an evidence check turns it into a solid gold VERIFIED chip. The board never lets a claim pass for a fact. (`truth-layer.md` Principle.)

The Old Republic posture is *in spirit only*: robes, naval officers, holo-architects, protocol droids, reformed dark-order warriors — all original characters with original names. No Star Wars names, species, likenesses, logos, or catchphrases appear anywhere. The tone is affectionate, not derivative. In-world flavor never costs clarity: every character always carries its plain role label (`builder`, `reviewer-code`) beside its name.

Dark only. Light mode is out of scope for the proof of concept (POC).

## Colors

Three chromatic families — holo cyan, Republic gold, danger red-orange — each with one job, plus amber for budget pressure. Everything else is navy. Hex values live only in the YAML.

| Family | Job | Used on | Tokens |
|---|---|---|---|
| **Space** (navy) | Tonal depth | Page `space-0`, board `space-1`, surfaces `space-2`, raised surfaces and Swimlane headers `space-3`. Slice cards run a vertical gradient `card-top` → `card-bottom`. | `space-0`–`space-3`, `card-top`, `card-bottom`; hairlines `line`, `line-strong`, `card-edge` are decorative and never carry meaning alone |
| **Holo cyan** | Agents and machine activity | CLAIMED chips, agent role labels, stage holo-plates, the current stage step, live slice spines, budget and time-box fills, the replay playhead, and focus rings | `holo`; shade `holo-2`; inks `holo-text`, `holo-text-2`, and `holo-text-3` (CLAIMED gloss); `on-holo` on solid holo; alpha fills `holo-a1`–`holo-a3` |
| **Republic gold** | *Gold belongs to d2t.* | Decision seals, gate diamonds, timeline pips, the Needs You column and its cards, the budget cut marker, VERIFIED chips (a verified fact is promoted to the human's trust level), the evidence-selected outline, and the Evidence drawer's top edge | `gold`; `gold-ink` on gold; `gold-hi` tops the VERIFIED gradient; `gold-2` is the dim gold of future replay pips; alpha fills `gold-a1` (drawer hero), `gold-a2` (MERGE hairline), and `gold-a3` (Action slot border). Needs You column: wash `needs-wash-top` → `needs-wash-bottom`, side edges `needs-edge`. Needs You cards: surface `needs-surface-top` → `needs-surface-bottom`, border `needs-card-edge`, inks `needs-text`, `needs-text-2`, and `needs-text-3`, plus `needs-chip-ink` for slice-id chips and the `· you` on the Master d2t seat |
| **Danger red-orange** | Danger only. Never decoration, never a brand accent, never a recording (REC) dot. | UNVERIFIED chips and SIGNAL LOST | `danger`; `on-danger` on solid danger; ink `danger-text` (UNVERIFIED label, SIGNAL LOST detail); fill `danger-a` |
| **Amber** | Budget pressure, nothing else | The AT RISK edge on Backlog slices once the cut point is reached, and the Budget clock's `+m:ss over` readout past 0:00 | `amber`; ink `amber-text` |
| **Nebula** | Atmosphere only | Three soft radial washes behind the starfield (opacities in Elevation & Depth) | `gold`, `nebula-violet`, `holo` |

**Role colors** (`role-*`) appear as a 6px square dot before each role label, as the verdict-list dot, and as each character's sprite accent. They identify *who*, never *state*; the role-to-color mapping lives in the Character roster. Kael Nox's crimson is a character color, visibly distinct from danger red-orange and never used for state; his role label uses `role-reviewer-security-text`. Recon and framer share olive: they fill the same stage slot and never appear in one lane. New role colors avoid the state hues and their neighbours (gold/sand, cyan, red-orange/copper, amber) and meet the 3:1 non-text floor on space-2.

### Contrast targets (screen-share legibility)

Floor: WCAG AA — 4.5:1 for all text, 3:1 for non-text state cues. Alpha fills are measured **composited** over the surface beneath. Measured on the approved tokens:

| Pair | Ratio |
|---|---|
| `text` on `space-1` | 17.3:1 |
| `text` on `card-top` | 13.5:1 |
| `text-2` on `card-top` | 8.5:1 |
| `text-3` on `card-top` (worst-case label) | 5.5:1 |
| `text-3` on `space-3` | 5.7:1 |
| `text-3` on `card-top`, board dimmed to 90% (OFFLINE) | 4.7:1 |
| `holo` on CLAIMED chip fill (densest scan line, `holo` 14% over `card-top`) | 7.4:1 |
| `gold` on `space-3` | 9.9:1 |
| `gold-2` on `space-2` (future pip labels) | 5.1:1 |
| `gold-ink` on `gold` (type tags, VERIFIED) | 11.6:1 |
| `on-holo` on `holo` (current stage, speed) | 13.0:1 |
| `danger-text` on UNVERIFIED chip fill (`danger-a` over `card-top`) | 8.2:1 |
| `danger` on UNVERIFIED chip fill (border only, non-text) | 4.5:1 |
| `danger-text` on `card-top` (SIGNAL LOST detail) | 9.8:1 |
| `on-danger` on `danger` (SIGNAL LOST tag) | 6.8:1 |
| `amber` on `card-top` (AT RISK) | 7.2:1 |
| `amber-text` on `card-top` (AT RISK detail) | 10.8:1 |
| `amber` on `space-3` (budget overrun) | 7.5:1 |
| `needs-text` on `needs-surface-top` | 13.0:1 |
| `needs-text-3` on `needs-surface-top` | 8.2:1 |
| `needs-chip-ink` on `needs-surface-top` | 10.7:1 |
| `role-reviewer-security-text` on `space-1` | 9.7:1 |

New tokens must be measured against `card-top` (the lightest surface that text sits on), composited if translucent, before use.

## Typography

System stacks only — no web fonts, nothing to download on a local tool:

- **Sans** (`ui-sans-serif, system-ui, …`) for content: card titles, run titles, reasons, and names.
- **Mono** (`ui-monospace, "SF Mono", …`) for anything the terminal or the machine would say: column titles, tags, chips, run ids, slice ids, commands, timestamps, hook facts, and readouts. Mono labels are uppercase and tracked (0.08–0.18em) — the board's "instrument panel" voice.

Ramp, largest first:

| Size | Sans | Mono |
|---|---|---|
| 19px | `brand` | — |
| 17px | — | `readout-lg` |
| 16px | `lane-title` | — |
| 15px | `needs-title` | `readout` |
| 14px | `card-title`, `body` | `needs-column-title` |
| 13px | `body-sm` | `command` |
| 12px | `label` | `column-title`, `data` |
| 11px | — | `tag`, `meta` |

**Minimum text size** is `{typography.tag.fontSize}` — a type floor that only mono tags and meta may use. Reading text (reasons, notes, drawer prose) is ≥ `{typography.body-sm.fontSize}`. Commands are `command` (semibold) so they read across a room. Agent names are `label` with a 1px black text shadow so they stay legible over the starfield.

## Layout & Spacing

Desktop only, designed at `{spacing.viewport-target}`. Below `{spacing.viewport-target}` the board keeps its column widths and the page scrolls horizontally; no responsive reflow in the POC.

The board is a five-column grid — `col-backlog` · `col-in-progress` · `col-in-review` · `col-needs-you` · `col-done` — separated by `column-gap` inside `board-gutter`. Needs You is deliberately the widest column: it is where the human acts. In Review is second-widest so a full reviewer cluster (four sprites around one card) fits; column widths grow at final sprite art (see Pixel sprites).

Each run is a full-width swimlane: a Swimlane header spanning all five columns, then one row of cells. Lanes stack vertically `lane-gap` apart. Column headers sit once at the top; the Needs You column's gold tint runs unbroken through every lane so the eye reads it as one human queue.

**Sticky:** the Top bar (`{spacing.topbar-height}`) and the column-header row (including the Master d2t seat) stay pinned while lanes scroll vertically, so Master d2t is always on screen; Swimlane headers scroll with their lane. The Replay bar (`{spacing.replay-height}`) is pinned at the bottom.

The Evidence drawer docks on the right at `{spacing.drawer-width}` and the board narrows to make room — the drawer never overlays cards.

Spacing scale: tokens `1`–`9`. Card padding is 10–13px; Needs You cards use 10px horizontal padding so the Action slot (command field + Copy button) fits `{spacing.col-needs-you}`; cards stack `card-gap` apart in a cell.

## Elevation & Depth

Depth comes from **tone and light**, not from shadow hierarchy.

- **Tone:** `space-0` page → `space-1` board → `space-2` surfaces → `space-3` Swimlane headers.
- **Light:** only holo and gold emit glow, with one exception: danger glows on the SIGNAL LOST type tag. Nothing else glows.
- **Hologram treatment:** translucent cyan gradient fill + horizontal scan lines + cyan corner brackets (6px L-marks, top-left and bottom-right) + soft outer glow. Used for stage cards and empty-cell "ghost" placeholders, and (scan lines + flicker only) for CLAIMED chips.

**Shadow & glow values.** Raw CSS values, deliberately *not* tokens; this table is their single source (copy from here, not from the mocks). Colors name their token (or black/white) plus an alpha.

| Effect | Value | Applies to |
|---|---|---|
| Inner highlight | `inset 0 1px 0`, white 7% | Slice cards (datapad edge) |
| Drop — slice card | `0 8px 16px`, black 35% | Slice cards |
| Drop — Needs You card | `0 10px 26px`, black 45% | Needs You cards |
| Drop — Swimlane header | `0 8px 20px`, black 25% | Swimlane headers |
| Drop — drawer | `-24px 0 48px`, black 50% | Evidence drawer |
| Drop — replay bar | `0 -12px 30px`, black 45% | Replay bar |
| Drop — sprite | `drop-shadow(0 6px 10px)`, black 55% (Master d2t); smaller on agents | Sprites |
| Holo glow — current step | `0 0 14px` `{colors.holo}` 55% | Current stage step |
| Holo glow — CLAIMED | `0 0 10px` `{colors.holo}` 20% | CLAIMED chips |
| Holo glow — plates | `0 0 16px` `{colors.holo}` 9% | Stage holo-plates |
| Holo glow — live spine | `0 0 8px` `{colors.holo}` 100% | Live slice spines |
| Holo glow — play button | `0 0 14px` `{colors.holo}` 35% | Replay play button |
| Holo-pad | radial `{colors.holo}` 55% → 12% → transparent, 54×12px ellipse | Under each agent |
| Gold glow — Decision seal | `drop-shadow(0 0 4px)` `{colors.gold}` 55% | Decision seal glyphs |
| Gold glow — VERIFIED | `0 0 12px` `{colors.gold}` 35% | VERIFIED chips |
| Gold glow — type tag | `0 0 12px` `{colors.gold}` 45% | Gold Type tags |
| Gold glow — pip | `0 0 8px` `{colors.gold}` 80% | Replay timeline pips |
| Gold glow — evidence-selected | `0 0 0 6px` `{colors.gold}` 12% + `0 0 22px` `{colors.gold}` 35% | Evidence-selected cards |
| Beacon | ring `0 0 0 0` → `0 0 0 14px`, `{colors.gold}` 60% → 0, plus steady `0 0 24px` 25% | Needs You cards |
| Danger glow | `0 0 12px` `{colors.danger}` 50% | SIGNAL LOST type tag only |
| Scan lines | 1px line every 3px: `{colors.holo}` 14% line / 5% gap (CLAIMED), white-cyan 5% (plates); `{colors.gold}` faint on Needs You cards | Hologram surfaces |
| Nebula | `{colors.gold}` 7% top-right · `{colors.nebula-violet}` 8% bottom-left · `{colors.holo}` 5% center | Starfield |
| Halo | radial `{colors.gold}` 30% → 10% → transparent, 230px; rays 10% conic, 260px | Master d2t seat |
| Drawer left edge | 1px `{colors.gold}` 40% | Evidence drawer |

## Shapes

A small, strict vocabulary:

- **Square = machine.** Done-stage ticks, role dots, current-stage blink, card status lights.
- **Diamond = human decision.** Gate diamonds in the stage track and decision pips on the replay timeline are 45°-rotated squares. Nothing else is a diamond.
- **Circle = time.** Playhead knob, play button, mode-badge dot, type-tag lamp.

**Radii** — reverse index; each component's radius lives in its YAML entry:

| Token | Used on |
|---|---|
| `xs` | Meters |
| `sm` | Slice-id chips, type tags, stage-track steps, mini chips |
| `md` | Claim chips, run-id chip, command field, copy button |
| `DEFAULT` | Stage cards, buttons, mode badge, Done deck |
| `inset` | Action slot and drawer tables (nested inside an `xl` card) |
| `lg` | Slice cards, legend, empty cell, drawer hero |
| `xl` | Needs You cards, Swimlane headers |
| `2xl` | Needs You column foot |
| `full` | Pills, play button |

Pixel-art rendering and scale rules live in Pixel sprites.

## Components

YAML keys are the kebab-case form of these names (for example, Slice card → `slice-card`). Names match `EXPERIENCE.md` Component Patterns exactly. "Seal" always means the **Decision seal**; the gold claim state is always the **VERIFIED chip**.

### Chrome

- **Top bar** — `space-2` → `space-1` gradient, cyan hairline below. Left: pixel emblem + `d2t-factory` in `brand`, with `dashboard · read-only` in `meta` beneath. Then the Mode badge, then (right-aligned) the Truth legend and the Reduce-motion toggle.
- **Mode badge** — 30px tall, `space-3` fill, `line-strong` border, `tag` type: a circle dot + mode word in `text` + detail in `text-2`. Variants:
  - REPLAY — dot `text-2` with a 3px `text-2` ring at 15%; `REPLAY · recorded 2026-10-22`; while a recording loads, `REPLAY · loading`.
  - LIVE — dot `holo` with a soft holo glow; `LIVE`.
  - OFFLINE — dot `text-3`, no glow, no danger color; `OFFLINE · reconnecting`. The board beneath the Top bar drops to 90% opacity; the Top bar stays at full strength.
- **Truth legend** — bordered strip: `LEGEND` + three Claim chips, each with a plain gloss: `CLAIMED agent says so` · `VERIFIED hook fact or evidence check confirms` · `UNVERIFIED no hook fact`. Always visible.
- **Reduce-motion toggle** — 34×18px switch (width × height) + `Reduce motion` label. On: track `holo-2`, white knob, slid right. Focus: 2px `holo` outline at 2px offset.
- **Starfield** — three repeating star layers (star sizes 1px, 1.5px, and 2px; 55–70% opacity) drifting left at different speeds over the nebula washes. Behind everything; never interactive.

### Board

- **Column header** — `column-title` uppercase in `text-2`, 1px `line` rule below, and the board-wide count in a small pill. Sticky (Layout & Spacing).
- **Needs You column** — the board's center of gravity: a gold-tinted column running through every lane, with a `needs-wash-top` → `needs-wash-bottom` vertical gradient, `needs-edge` side edges, and an inner glow. Its header is the **Master d2t seat**: the largest sprite (4× scale) on a radial gold halo with slowly rotating rays; the label `Master d2t` in gold + `· you` in `needs-chip-ink`; then `NEEDS YOU` in `needs-column-title` with a solid gold count pill.
- **Swimlane header** — full-width `space-3` plate with a `holo-a2` border. Row 1: conductor sprite (1×) + `Adm. Vess Korrin` / `conductor` (holo, mono), then a divider · run-id chip (`r-7f3a`) · run title in `lane-title` · origin tag (`brownfield` / `greenfield`) · `STAGE BUILD` (stage in holo; in gold when waiting on d2t, for example `STAGE GATE 1`, `STAGE MERGE`) · Budget clock. Row 2: Stage track.
- **Budget clock** — 236px wide. Clock glyph + `BUDGET` + `1:12` (`readout`) + `left of 2:00`. Below, an 8px-tall meter: holo fill draining leftward with 1px dark tick segments every 6px, and a 2px-wide gold cut marker that overshoots the track by 4px top and bottom. Caption `▲ cut point at 0:40 left`, with `▲ cut point` in gold. Past 0:00 the value reads `+m:ss over` in `amber` and the track is empty. No-limit variant: same 236px slot, clock glyph + `ELAPSED` + `0:47` (`readout`) + `· no limit` in `text-3`; no meter, no caption.
- **Lane notice (PAUSED)** — after the stage in the Swimlane header: `PAUSED` in `text-2` `tag` + `· you rejected a tool call 15:24` (or `· the conductor stopped after 3 blocks 15:24`) in `text-3`. Not danger: the run is resumable.
- **Stage track** — `INTAKE · RECON/FRAME · SCAFFOLD · SPEC∥DESIGN · ◆GATE 1 · SLICE PLAN · ◆GATE 2 · BUILD · WRAP · ◆MERGE`, joined by 1px wires (cyan up to the current step, `line` after it). `BUILD` is the board label for the spec's BUILD LOOP.
  - Steps: done = cyan-tinted with a `holo-2` square tick; now = solid holo, `on-holo` ink, glow, blinking square; future = dim `text-3`.
  - Gates: approved = solid gold diamond + gold label; waiting = solid gold pill `GATE 1 · NEEDS YOU` with a hollow diamond in `gold-ink`; future (or sent back by rework) = hollow diamond, label in `gold-2`.
  - MERGE waits the same way — `MERGE · NEEDS YOU`, with WRAP shown done. → mock: key-wrap lane `r-7f3a`
- **Empty cell** — dashed `holo-a2` border, three ghost datapads (hologram outlines, the middle one raised 3px), a mono title (`AWAITING GATE 1`, `holo-text-2`), and a one-line explanation (`Slices are dealt here once the slice plan clears Gate 2.`, `text-3`). Columns that are simply idle stay blank.
- **Done stack** — *canonical visual; behavior in `EXPERIENCE.md` Component Patterns.* Cards stack newest first; the collapsed deck reads `+3` (bold, `holo-text`) + the collapsed names (`INTAKE · RECON · SCAFFOLD`), drawn with two offset edge lines suggesting stacked cards. Below the names, a **seal row**: one gold Decision-seal glyph per seal on any collapsed card, in collapse order (18px, the 9×9 pixel glyph at 2×; 4px gap; wraps), each with the gold seal drop-glow. Glyph states: hover = `space-3` plate behind the glyph, no extra gold; keyboard focus = 2px `{colors.holo}` ring at 2px offset; selected (its Decision drawer is open) = 2px `gold` outline on the glyph, and the deck carries the `EVIDENCE ▸` tab. Seals are never hidden. → mock: key-wrap lane `r-7f3a` Done and key-wrap States 01

### Cards and their parts

- **Stage card** — a holo-plate: hologram treatment, stage glyph (9×9 pixel icon at 2×) + stage name in `holo-text`, optional right-aligned meta, and Decision seals stacked below the name. Wide, short, translucent — visually "a phase," not "a task." Glyphs exist for INTAKE, RECON, SCAFFOLD, SPEC, DESIGN, and SLICE PLAN. FRAME and WRAP need glyphs drawn in the same 9×9 style. Variants: **SIGNAL LOST** and **evidence-selected**, drawn exactly as on the Slice card.
- **Slice card** — a datapad: opaque navy gradient, `card-edge` border, inner top highlight, a 3px-wide left spine, and two tiny status lights top-right (spine and lights `line-strong` when idle, holo with glow when an agent is working it). Slice-id chip (`S3`, mono tag) above the title in `card-title`. Optional: `meta` line (`round 1/2` once findings have bounced it), Time box meter, Claim chip, Verdict list, Decision seals. Compact, solid — "a task." Variants:
  - **AT RISK** — `amber` 55% border, `amber` 10% wash from the left, 4px-wide dashed `amber` spine (5px dash, 3px gap); label `AT RISK` in `amber` `tag` + `· cut candidate` in `amber-text`. → mock: key-dashboard States 03
  - **SIGNAL LOST** — `danger` border; label: 7px `danger` square + `SIGNAL LOST` in `danger` `tag` + `· last seen 4m ago` in `danger-text`; the label flickers. → mock: key-dashboard States 02
  - **Evidence-selected** — 2px `gold` outline at 2px offset with the gold selected glow; an `EVIDENCE ▸` tab (`gold` fill, `gold-ink`, `tag`) on the top-right edge. → mock: key-dashboard lane `r-7f3a` Done (S1)
  - **Findings queued** — `findings queued` in `holo-text` `tag` below the title while the slice waits in In Review for its builder.
  - **Cut** (in Done) — spine `line-strong`, status lights off, a `CUT` tag in `text-3` where the Claim chip would be, and the Decision seal `cut · Master d2t`. No strike-through, no fade: the title keeps full contrast.
- **Time box meter** — `TIME BOX` left, `18 / 30 min` right (`meta`; value bold, `text`), 6px-tall holo meter below.
- **Verdict list** — under a hairline, one row per assigned reviewer: role-color dot · short name · verdict word in `tag` + mini Claim chip. Verdict word colors: `APPROVE` in `text`; `ESCALATE` in `text`; any other verdict value (for example, findings) in `holo-text`; no verdict file yet → `reviewing…` in `text-3` with a blinking ellipsis and no chip. Verdicts are agent claims: never gold.
- **Claim chip** — 22px tall (18px tall "mini" in verdict rows), mono `tag` label + optional sans gloss (`tests pass`). → mock: key-dashboard States 01
  - **CLAIMED** — hologram: `holo` text with cyan text-glow, scan-line fill, `holo` 60% border, outer glow, irregular flicker; gloss in `holo-text-3`. The waiting glosses (`· awaiting Master d2t`, `· checks running`) use the same treatment, with the gloss in `holo-text-2`.
  - **VERIFIED** — solid gold: `gold-hi` → `gold` gradient, `gold-ink` label, a gold pixel glyph (the same drawing as the Decision seal's — the shared glyph does not make it a seal), periodic white sheen sweep; pointer cursor (opens the Evidence drawer). The word `VERIFIED` is always present, before any gloss.
  - **UNVERIFIED** — `danger-text` label, `danger` border on `danger-a` fill, faster flicker, gloss `no hook fact`.
- **Decision seal** — gold pixel seal glyph with drop-glow + `tag`-weight gold line naming the decision and the human: `Gate 2 · approved by Master d2t`, `intake confirmed · Master d2t`, `rework · Master d2t`, `escalation ruled · Master d2t`. Sits on the card the decision touched and persists into Done; when that card collapses, the seal moves onto the Done deck (Done stack). Pointer cursor (opens the Evidence drawer, Decision variant).
- **Needs You card** — warm gold-to-navy gradient, `needs-card-edge` border, faint gold scan lines, and the beacon (Elevation & Depth). Anatomy: Type tag + right-aligned `when` (`raised 14:36`, `ready 14:29`) · title in `needs-title` (optionally prefixed by the slice-id chip in `needs-chip-ink`) · `REASON` block in `body-sm` with the reason label bolded (labels in `EXPERIENCE.md`) · optional variant content · Action slot. → mock: key-dashboard Needs You column (lane `r-2c91`) and key-dashboard States 02–03
  - **Gate 1** — optional content: SPEC and DESIGN mini plates + plain-text checks with a gold count badge (for example, `3 assumptions to check`). No Claim chips; these are d2t's to check.
  - **MERGE** — title `Merge ready — <run title>`; branch line `<branch> → main` (`meta`, `needs-text-3`); then the re-verified rows under a `gold-a2` hairline, one per check: the test command (`npm test`, mono) and the reviewer-code verdict (role-color dot · `Tarvus` · `APPROVE`), each ending in a mini VERIFIED Claim chip. Conflicted variant: a `RESOLUTIONS` block (mono label in `needs-text-3`; one `file — resolution` line per conflicted file) sits above the re-verified rows. → mock: key-wrap Needs You column and key-wrap States 02
  - **SIGNAL LOST** — keeps the gold frame but carries a danger Type tag. → mock: key-dashboard States 02
- **Type tag** — 22px tall, solid, `tag` type tracked 0.14em, blinking circle lamp: `GATE`, `ESCALATION`, `CUT`, and `MERGE` on gold with `gold-ink`; `SIGNAL LOST` on `danger` with `on-danger`.
- **Action slot** — dashed `gold-a3` box, `space-0` 55% fill. Label `> RESPOND IN TERMINAL` in gold `tag`; below, the command in a `space-0` field (`command` type, white, `$ ` prompt in `text-3`) and a 30×30px gold-outlined Copy button with a pixel copy glyph. Each command row is followed by its `then` line in `body-sm`, `needs-text-3`; the card's reply line closes the slot in `body-sm`, `text-3`. With several commands, the rows stack inside one slot. The slot's footprint is reserved for a future action button.
- **Agent sprite** — pixel character at 2× + name (`label`, `text`) + role label (`meta`, `holo`, prefixed by the 6px role-color dot); Kael's role label uses `role-reviewer-security-text`. A holo-pad glows under the feet. Agents stand above the card they work (overlapping its top edge), cluster around a card in review (two above, two below), or sit beside a Needs You card when standing by (horizontal "side" layout). See Pixel sprites below. Every agent role has a character (Character roster); none is drawn as the conductor. The conductor appears only in the Swimlane header. Check droids stand beside the card whose checks are running, at the agent scale; they leave when their check is verified.

### Panels

- **Evidence drawer** — docked panel at `drawer-width`: `space-2` → `space-1` gradient, a 40% gold left edge (Shadow & glow values), and a 3px `gold` top bar. Head: kicker `EVIDENCE DRAWER`, title, and a 28×28px close button `×`. Footer: card and run reference. While the drawer is open, the source card is evidence-selected. Three variants:
  - **Claim** (from a Claim chip). → mock: key-dashboard Evidence drawer
    - Title: `Evidence · S1 tests pass · VERIFIED` (state word in its state color).
    - Hero on a `gold-a1` plate: large gold glyph + `VERIFIED` + `A hook fact matched Brix's claim.`
    - Proof table (92px-wide mono key column), headed `HOOK FACT` or `EVIDENCE CHECK` depending on the proof source. Rows: event · command · exit code (gold `0` badge) · timestamp · session.
    - `CLAIM → PROOF` chain: cyan node `CLAIMED by Brix 14:02:09 · "tests pass"` → gradient line → gold node `VERIFIED by hook 14:02:11 · exit code 0`, plus a one-line summary.
    - Note with gold left rule: **Agents can claim. Only a hook fact or an evidence check can verify.**
  - **Decision** (from a Decision seal). → mock: key-wrap Evidence drawer (Gate 2) and key-wrap States 03 (escalation ruling)
    - Title: `Decision · <Event> · <run-id>` (`Decision · Gate 1 · r-2c91`, `Decision · Gate 2 · r-7f3a`, `Decision · Escalation · r-7f3a`).
    - Hero on a `gold-a1` plate: large Decision-seal glyph + `DECISION` (gold, mono) + the seal line (`Gate 1 · approved by Master d2t`).
    - `DECISION` table (92px-wide mono key column), one row each:
      - event — the state-machine event, verbatim; real names come from the factory state machine in the architecture (the mocks' names are illustrative; see Mock deviations).
      - reason — ESCALATION decisions only: the reason label in bold + its line, verbatim from the reason-label table in `EXPERIENCE.md`, in `body-sm`.
      - decided by — `Master d2t`.
      - at — timestamp.
      - terminal response — d2t's reply or choice, verbatim, in `data`.
      - run / stage.
      - evidence checked — one row per gate-evidence check, each with its Claim chip; `none required` when the decision has none.
    - No claim chain.
    - Note with gold left rule: **Agents can claim. Only Master d2t decides.**
  - **Artifact** (from a Gate card's file row, the intake seal, or a Decision drawer evidence row)
    - Title: `Artifact · spec.md · r-7f3a`.
    - Meta table (92px-wide mono key column): path (mono, with the 30×30px Copy button; accessible name `Copy path`), sha256 (first 12 characters; the full hash in the accessible name), pinned (the seal line in gold, or `not yet approved` in `text-3`).
    - Body in `data` type on `space-0`, read-only, scrolling inside the drawer; no Markdown rendering. A `truncated at 64 KB` note in `text-3` when cut.
    - Note with gold left rule: **Master d2t approves these bytes.**
- **Replay bar** — sticky footer at `replay-height`. → mock: key-dashboard Replay bar
  - Controls: `prev decision` / play-pause (44px-diameter round button, cyan rim) / `next decision` buttons.
  - Speed: `SPEED` segmented `1× 4× 16×` (active segment solid holo).
  - Timeline: 6px-tall track with cyan played portion, gold diamond pips per human decision (`gold-2` pips and labels for future ones), mono labels alternating above and below (`Gate 1 · r-7f3a`, `intake · r-2c91`), and a white playhead line with a cyan knob.
  - Time: `REPLAY TIME 00:47:12 / 01:38:40` in `readout-lg`.
  - While a recording loads, controls are `aria-disabled` with labels in `text-3`.

### Pixel sprites

| Rule | Spec |
|---|---|
| Final art | 32×32 px, nearest-neighbor (`image-rendering: pixelated`, `shape-rendering: crispEdges`). Whole-number scale factor **per slot**: lane-header conductor 1× (32px) · board agents 2× (64px) · Master d2t seat 4× (128px). No other scales. |
| Palette | Shared 20-color palette (`sprite-*` tokens: 16 core + 4 accents). No off-palette pixels. |
| Light | Single source, top-left. Highlight on top/left edges, shade bottom/right. |
| Animation | 4-frame idle + 4-frame walk per character, plus at most one signature effect. |
| Current placeholders | 16×16 inline SVG at 3× (48px) on the board and 2× (32px) in Swimlane headers; Master d2t 32×30 at 4× (128×120). 2-frame idle (stepped 3px bob) + per-character effect frames. Replaced wholesale by the separate image-generation project. |
| Layout at final art | Column widths were sized on 48px placeholders. At 64px, the columns that hold sprites grow to fit sprite + name label: In Review (two-over-two cluster), In Progress (agent above its card), and Needs You (standby side layout). Backlog and Done hold no sprites and keep their widths. The seat grows to 128px tall. Final widths are set when the art lands. |
| Accessibility | Sprites are decorative (`aria-hidden`); the name and role label beside them are real text. |

### Character roster

All original characters, Old Republic in spirit. Name + role label always visible. **Display name** is the short form in parentheses (or the name itself when none is given); it is used everywhere — board labels, reason text, chat — so card and chat match verbatim. Full names appear only in this table.

| Name (short) | Role | Look | Role color | Signature on board |
|---|---|---|---|---|
| Master d2t | human operator (robed master) | Hooded brown robe, gold trim | `{colors.role-d2t}` gold | Largest sprite, seated atop Needs You under a halo; looks up when a card enters and periodically while idle |
| Admiral Vess Korrin (`Adm. Vess Korrin`) | conductor | Naval officer, grey uniform | — (label in `{colors.holo}`) | Lives in every Swimlane header; slow bob, 2s effect cycle |
| Brix | builder | Armored engineer, welding sparks | `{colors.role-builder}` steel | Rapid spark flicker at the torch |
| Sela Venn | designer | Holo-architect | `{colors.role-designer}` violet | 2-frame working effect, 1.1s cycle |
| Archivist Tarvus (`Tarvus`) | reviewer-code | Grey-bearded scholar with datapad | `{colors.role-reviewer-code}` sage | 2-frame working effect, 0.7s cycle |
| Kael Nox | reviewer-security | Reformed dark-order warrior, red visor | `{colors.role-reviewer-security}` crimson | Visor scan sweep, drifting embers, crimson aura, dashed standby pad |
| Mira Sol | reviewer-ux | Impatient smuggler-pilot | `{colors.role-reviewer-ux}` pink | 2-frame working effect |
| P-11 "Pell" (`Pell`) | reviewer-a11y | Protocol droid | `{colors.role-reviewer-a11y}` silver | Photoreceptor blink |
| Envoy Quill (`Quill`) | reviewer-ui | Image-obsessed diplomat | `{colors.role-reviewer-ui}` teal | 2-frame working effect, 1.6s cycle |
| Surveyor Nyra Kest (`Nyra`) | recon | Hooded scout with a survey scanner | `{colors.role-recon}` olive `#b8c25e` | Scanner sweep: a 3-frame cone in front of her |
| Shipwright Halden Roe (`Halden`) | framer | Shipwright with a blueprint roll | `{colors.role-framer}` olive `#b8c25e` (shared with recon) | Blueprint unrolls and rolls, 1.4 s cycle |
| Dockmaster Tamsin Brann (`Tamsin`) | scaffolder | Dock officer with a cargo manifest and a hand lamp | `{colors.role-scaffolder}` orchid `#d68ae6` | Hand lamp blinks as she checks the manifest |
| Magistrate Ione Vatch (`Ione`) | spec-writer | Formal robes, charter tablet | `{colors.role-spec-writer}` periwinkle `#8ea2ff` | Tablet lines appear one by one, 1.2 s cycle |
| Tactician Sorel Danth (`Sorel`) | slicer | Officer at a small holo-map, moving markers | `{colors.role-slicer}` peach `#f2c7a0` (`sprite-skin-light`) | Markers blink into slots on the map |

### Check droids

The CLI's own checks, drawn as one shared droid chassis (small box body on treads, one photoreceptor, a status light). They are instruments, not agents: no role color; their dot is a 6px outlined square (1px text-2). Name + role label as for characters.

| Name (short) | Check | Role label |
|---|---|---|
| LX-4 "Crate" (`Crate`) | contract.install | install check |
| VT-2 "Pulse" (`Pulse`) | contract.health | health check |
| TQ-6 "Gauge" (`Gauge`) | contract.test | test check |
| MR-3 "Margin" (`Margin`) | spec.lint | spec lint |
| PL-5 "Tally" (`Tally`) | plan.lint | plan lint |

Signature: the status light blinks in sprite-holo while the check runs; frame 1 when idle.

### Mock deviations — spine wins

Do not copy these from the mocks:

| In the mock | Spine rule |
|---|---|
| Mode badge border `#4e5f97`, fill `#141d42`, 12px text | `{colors.line-strong}` border, `{colors.space-3}` fill, `tag` (11px) |
| Off-token navies `#0a1128`, `#0b1230`, `#121b3c`, `#3a4a80`, `#2d3b6c`, `#2a3868` (run-id chip, meter tracks, buttons, idle status lights, command field border) | The token named in that component's YAML; idle status lights and slice spines `line-strong`, meter tracks `space-1` |
| Swimlane header border cyan 20%, Empty cell border cyan 25%, MERGE hairline gold 22% | `{colors.holo-a2}` borders; `{colors.gold-a2}` hairline |
| Future pips `#3a2e10`, future pip and future-gate labels `#c9a75a` | `{colors.gold-2}` |
| VERIFIED gradient stop `#e0ae32`, border `#ffe7a0`; drawer hero text `#efe2bf` | `gold-hi` → `gold` gradient; hero text `needs-text-2` |
| UNVERIFIED label in `danger` | `danger-text` label (contrast, in Colors) |
| Card VERIFIED chips show only the gloss | The word `VERIFIED` always precedes the gloss |
| `key-dashboard`: Done deck lists collapsed names but no seal glyphs (INTAKE's seal is hidden) | The deck carries one gold seal glyph per collapsed seal (Done stack) |
| `key-wrap`: Decision drawer event names `gate_2_approved`, `escalation_ruled` | Illustrative; real event names come from the factory state machine in the architecture (Evidence drawer) |
| 16×16 placeholders at 48px, 2-frame idles, no travel animation | Final art and motion per Pixel sprites and `EXPERIENCE.md` Motion |
| `key-dashboard`: `Brix vs Envoy Quill` in the S4 REASON line (card and chat) | Short display names everywhere: `Brix vs Quill` (Character roster; `EXPERIENCE.md` Voice and Tone) |
| `key-dashboard`: port `4317` in the replay URL | Port is an architecture decision; avoid `4317` (OpenTelemetry default) — `EXPERIENCE.md` Modes |
| Any other raw hex (star tints, gradient intermediates) | Illustrative only; use the nearest named token |

## Do's and Don'ts

| Do | Don't |
|---|---|
| Original characters, names, and gear in an Old Republic *spirit* | **Use any Star Wars name, species, character likeness, logo, ship, or catchphrase — hard rule, no exceptions** |
| Gold for d2t and only d2t: decisions, seals, Needs You, gates, pips, VERIFIED | Gold on agent activity (including verdict words), decoration, or hover |
| Cyan for agents and CLAIMED | Cyan on anything the human decided |
| Red-orange `danger` only for UNVERIFIED and SIGNAL LOST | Red-orange for emphasis, branding, recording (REC) dots, or Kael (he is crimson) |
| Amber only for budget pressure: AT RISK and clock overrun | Amber as a general warning color |
| Pair every state color with its text label (`CLAIMED`, `VERIFIED`, `UNVERIFIED`, `SIGNAL LOST`, `AT RISK`, `CUT`) | Let color or a glyph alone carry a state |
| Keep Decision seals on cards forever, including Done; collapsed cards hand their seals to the deck's seal row | Fade, collapse away, or hide a seal when a card ages |
| Call the gold claim state a VERIFIED chip; reserve "seal" for Decision seals | Call a VERIFIED chip a seal |
| Diamonds for human decisions only | Diamonds as generic bullets or status icons |
| Nearest-neighbor pixel art from the shared palette, scaled by whole-number factors at the per-slot scale | Smoothed, fractionally scaled, or off-palette sprites |
| Name + role label beside every sprite | A sprite without readable text |
| `{typography.tag.fontSize}` minimum, mono tags only; reading text ≥ `{typography.body-sm.fontSize}` | Shrink text to fit more cards |
| Dock the Evidence drawer and narrow the board | Overlay the drawer on cards |
| Light-mode ideas parked for after the POC | Ship a light theme or a partially themed light mode |
