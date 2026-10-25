---
name: d2t-factory dashboard
description: Read-only local board that shows every factory run as a swimlane of cards worked by original Old Republic-spirited pixel characters, with d2t's decisions in gold and every agent claim marked claimed or verified. Dark only.
status: draft
updated: 2026-10-23
sources:
  - ../../../specs/spec-poc-factory-plugin/SPEC.md
  - ../../../specs/spec-poc-factory-plugin/pipeline-stages.md
  - ../../../specs/spec-poc-factory-plugin/review-policy.md
  - ../../../specs/spec-poc-factory-plugin/truth-layer.md
  - mockups/key-dashboard.html
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
  needs-text-sid: '#f3dfa8'
  # Danger only
  danger: '#ff6a3d'
  danger-a: '#ff6a3d24'
  danger-text: '#ffc2ad'
  on-danger: '#1d0700'
  # Budget at-risk
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
  min-text: 11px
components:
  top-bar:
    background: '{colors.space-2}'
    border: '{colors.holo-a2}'
    height: '{spacing.topbar-height}'
    title: '{typography.brand}'
  mode-badge:
    background: '{colors.space-3}'
    foreground: '{colors.text}'
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
    tint: '{colors.gold-a2}'
    edge: '{colors.gold-a3}'
    title: '{colors.gold}'
    title-type: '{typography.needs-column-title}'
    count-pill: '{colors.gold}'
    count-pill-ink: '{colors.gold-ink}'
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
    radius: '{rounded.DEFAULT}'
  slice-card:
    background-top: '{colors.card-top}'
    background-bottom: '{colors.card-bottom}'
    border: '{colors.card-edge}'
    spine-live: '{colors.holo}'
    title: '{typography.card-title}'
    id-chip-type: '{typography.tag}'
    radius: '{rounded.lg}'
  time-box-meter:
    fill: '{colors.holo}'
    track: '{colors.space-1}'
    type: '{typography.meta}'
  verdict-list:
    rule: '{colors.line}'
    name: '{colors.text-2}'
    verdict: '{typography.tag}'
  claim-chip:
    claimed: '{colors.holo}'
    verified: '{colors.gold}'
    verified-ink: '{colors.gold-ink}'
    unverified: '{colors.danger}'
    unverified-fill: '{colors.danger-a}'
    type: '{typography.tag}'
    radius: '{rounded.md}'
  decision-seal:
    foreground: '{colors.gold}'
    type: '{typography.tag}'
  needs-you-card:
    background-top: '{colors.needs-surface-top}'
    background-bottom: '{colors.needs-surface-bottom}'
    border: '{colors.gold-a3}'
    title: '{colors.needs-text}'
    title-type: '{typography.needs-title}'
    body: '{colors.needs-text-2}'
    label: '{colors.needs-text-3}'
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
    pad-glow: '{colors.holo-a3}'
  done-stack:
    deck-border: '{colors.holo-a2}'
    deck-count: '{colors.holo-text}'
    type: '{typography.meta}'
  empty-cell:
    border: '{colors.holo-a2}'
    title: '{colors.holo-text-2}'
    body: '{colors.text-3}'
    radius: '{rounded.lg}'
  evidence-drawer:
    background: '{colors.space-2}'
    edge: '{colors.gold}'
    width: '{spacing.drawer-width}'
    fact-type: '{typography.data}'
    radius-fact: '{rounded.inset}'
  replay-bar:
    background: '{colors.space-2}'
    height: '{spacing.replay-height}'
    speed-on: '{colors.holo}'
    speed-on-ink: '{colors.on-holo}'
    pip: '{colors.gold}'
    playhead: '{colors.holo}'
    time: '{typography.readout-lg}'
  starfield:
    base: '{colors.space-1}'
    nebula-gold: '{colors.gold}'
    nebula-violet: '{colors.nebula-violet}'
    nebula-holo: '{colors.holo}'
---

# d2t-factory dashboard — Design Spine

→ Visual reference: `mockups/key-dashboard.html` (approved in full, 2026-10-23). This spine wins on conflict with the mock.

## Brand & Style

The dashboard is a war table aboard an Old Republic flagship, not a SaaS admin panel. A dark starfield drifts behind a five-column board; each factory run is a swimlane commanded by its conductor; small pixel-art characters walk from card to card doing the work. It is built to be watched on a shared screen during an interview, so it has to be charming at a glance and exact on inspection.

Two ideas govern every pixel:

1. **The human outranks the agents.** d2t appears as *Master d2t*, the largest sprite on the board, seated above the Needs You column under a slow gold halo. Everything d2t decides — gates, cuts, merges, escalation rulings — is gold and leaves a gold seal that never fades, even in Done. Agents glow cyan; d2t glows gold. (SPEC Constraint: every surface foregrounds human decisions; CAP-15.)
2. **Agents claim; hooks verify.** An agent's say-so is a flickering cyan hologram. Only a hook fact turns it solid gold. The board never lets a claim pass for a fact. (`truth-layer.md`.)

The Old Republic posture is *in spirit only*: robes, naval officers, holo-architects, protocol droids, reformed Sith — all original characters with original names. No Star Wars names, species, likenesses, logos, or catchphrases appear anywhere. The tone is affectionate, not derivative. In-world flavor never costs clarity: every character always carries its plain role label (`builder`, `reviewer-code`) beside its name.

Dark only. Light mode is out of scope for the POC.

## Colors

Three chromatic families, each with one job. Everything else is navy.

- **Space (`#04060f` → `#142048`)** — four tonal layers: page (`space-0`), board (`space-1`), surfaces (`space-2`), raised surfaces and lane headers (`space-3`). Slice cards run a vertical gradient `card-top #17234d` → `card-bottom #0e1738`. Hairlines are `line #26345f`; they are decorative and never carry meaning alone.
- **Holo cyan (`#5ee7ff`)** — agents and machine activity: CLAIMED chips, agent role labels, stage holo-plates, the current stage step, live slice spines, budget and time-box fills, the replay playhead, focus rings. Shade `holo-2 #1f8fb8`; tinted inks `holo-text #bff4ff`, `holo-text-2 #9edff0`, `holo-text-3 #c9f7ff`.
- **Republic gold (`#f6c64a`)** — *gold belongs to d2t.* Decision seals, gate diamonds, timeline pips, the Needs You column and its cards, the budget cut marker, VERIFIED chips (a verified fact is promoted to the human's trust level), the selected-card outline, and the evidence drawer's top edge. Text on gold is `gold-ink #1a1204`. Needs You cards sit on a warm gradient `needs-surface-top #362a10` → `needs-surface-bottom #0f1121` with gold-tinted inks (`needs-text #fff6dd`, `needs-text-2 #e9dcc0`, `needs-text-3 #d8c48e`).
- **Danger red-orange (`#ff6a3d`)** — danger only: UNVERIFIED chips and SIGNAL LOST. Never decoration, never a brand accent, never a record dot. Text on danger is `on-danger #1d0700`; tinted ink `danger-text #ffc2ad`.
- **Amber (`#ff9a2e`)** — one job: the AT RISK edge on Backlog slices after the budget cut point is reached. Tinted ink `amber-text #ffd2a1`.
- **Nebula** — three soft radial washes behind the starfield: gold top-right (7%), violet `nebula-violet #785aff` bottom-left (8%), cyan center (5%). Atmosphere only.

**Role colors** appear as a 6px square dot before each role label, as the verdict-list dot, and as each character's sprite accent. They identify *who*, never *state*: `role-builder #9aa6bf` steel, `role-designer #a487ff` violet, `role-reviewer-code #8cc084` sage, `role-reviewer-security #e5283f` crimson, `role-reviewer-ux #ff8fb1` pink, `role-reviewer-a11y #dfe8f7` silver, `role-reviewer-ui #3fcfa6` teal, `role-d2t` = gold. Kael Nox's crimson is a character color; it is visibly distinct from danger red-orange and is never used for state.

### Contrast targets (screen-share legibility)

Floor: WCAG AA — 4.5:1 for all text, 3:1 for non-text state cues. [ASSUMPTION] numeric target; sources say only "must meet contrast for screen share/projector." Measured on the approved tokens:

| Pair | Ratio |
|---|---|
| `text` on `space-1` | 17.3:1 |
| `text` on `card-top` | 13.5:1 |
| `text-2` on `card-top` | 8.5:1 |
| `text-3` on `card-top` (worst-case label) | 5.5:1 |
| `text-3` on `space-3` | 5.7:1 |
| `holo` on CLAIMED chip fill | 9.9:1 |
| `gold` on `space-3` | 9.9:1 |
| `gold-ink` on `gold` (type tags, VERIFIED) | 11.6:1 |
| `on-holo` on `holo` (current stage, speed) | 13.0:1 |
| `danger` on UNVERIFIED chip fill | 5.3:1 |
| `on-danger` on `danger` (SIGNAL LOST tag) | 6.8:1 |
| `amber` on `card-top` (AT RISK) | 7.2:1 |
| `needs-text` on `needs-surface-top` | 13.0:1 |
| `needs-text-3` on `needs-surface-top` | 8.2:1 |
| `role-reviewer-security-text` on `space-1` | 9.7:1 |

New tokens must be measured against `card-top` (the lightest surface text sits on) before use.

## Typography

System stacks only — no web fonts, nothing to download on a local tool:

- **Sans** (`ui-sans-serif, system-ui, …`) for content: card titles, run titles, reasons, names.
- **Mono** (`ui-monospace, "SF Mono", …`) for anything the terminal or the machine would say: column titles, tags, chips, run ids, slice ids, commands, timestamps, hook facts, readouts. Mono labels are uppercase and tracked (0.08–0.18em) — the board's "instrument panel" voice.

Ramp: `brand` 19 · `readout-lg` 17 · `lane-title` 16 · `needs-title` 15 / `readout` 15 · `card-title` 14 / `body` 14 / `needs-column-title` 14 · `body-sm` 13 / `command` 13 · `label` 12 / `column-title` 12 / `data` 12 · `tag` 11 / `meta` 11.

**Minimum text size is 11px** (`{spacing.min-text}`), and 11px is reserved for mono tags and meta. Reading text (reasons, notes, drawer prose) is ≥13px. Commands are 13px semibold so they read across a room. Agent names are 12px semibold with a 1px black text shadow so they hold over the starfield.

## Layout & Spacing

Desktop only, designed at `{spacing.viewport-target}` (1440px). The board is a five-column grid — Backlog 160 · In Progress 196 · In Review 250 · Needs You 272 · Done 170 — with a 10px column gap and 16px gutters. Needs You is deliberately the widest column: it is where the human acts. In Review is second-widest so a full reviewer cluster (four sprites around one card) fits.

Each run is a full-width swimlane: a lane header spanning all five columns, then one row of cells. Lanes stack vertically 18px apart (`{spacing.lane-gap}`). Column headers sit once at the top; the Needs You column's gold tint runs unbroken through every lane so the eye reads it as one human queue.

The evidence drawer docks on the right at `{spacing.drawer-width}` (320px) and the board narrows to make room — it never overlays cards. The replay bar is sticky at the bottom (`{spacing.replay-height}`, 86px). The top bar is 64px.

Spacing scale: 4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20. Card padding is 10–13px; cards stack 10px apart in a cell. [ASSUMPTION] Below 1440px the board keeps its column widths and the page scrolls horizontally; no responsive reflow in the POC.

## Elevation & Depth

Depth comes from **tone and light**, not from shadow hierarchy.

- **Tone:** `space-0` page → `space-1` board → `space-2` surfaces → `space-3` lane headers. Slice cards add a 1px top inner highlight (`rgba(255,255,255,.07)`) — a physical datapad edge.
- **Shadow:** one soft drop per physical object — slice cards `0 8px 16px` at 35% black; Needs You cards `0 10px 26px` at 45%; lane headers `0 8px 20px` at 25%; the docked drawer casts left `-24px 0 48px` at 50%; the replay bar casts up `0 -12px 30px` at 45%. Sprites drop a small shadow; Master d2t's is deepest.
- **Light:** only holo and gold emit glow. Holo glows around plates, the current stage step, live card spines, CLAIMED chips, the playhead, and the elliptical "holo-pad" under each agent's feet. Gold glows around seals, gate diamonds, pips, type tags, the Needs You beacon and the Master's halo. Danger glows only on the SIGNAL LOST type tag. Nothing else glows.
- **Hologram treatment:** translucent cyan gradient fill + 1px horizontal scan lines every 3px + cyan corner brackets (6px L-marks, top-left and bottom-right) + soft outer glow. Used for stage cards and empty-cell "ghost" placeholders, and (scan lines + flicker only) for CLAIMED chips.

## Shapes

A small, strict vocabulary:

- **Square = machine.** Done-stage ticks, role dots, current-stage blink, card status lights.
- **Diamond = human decision.** Gate diamonds in the stage track and decision pips on the replay timeline are 45°-rotated squares. Nothing else is a diamond.
- **Circle = time.** Playhead knob, play button, mode-badge record dot, type-tag lamp.

Radii: `xs` 2px meters · `sm` 3px slice-id chips, type tags, stage-track steps, mini chips · `md` 4px claim chips, run-id chip, command field, copy button · `DEFAULT` 6px stage cards, buttons, mode badge, Done deck · `inset` 7px action slot and hook-fact table (nested inside a 10px card) · `lg` 8px slice cards, legend, empty cell, drawer hero · `xl` 10px Needs You cards, lane headers · `2xl` 14px Needs You column foot · `full` pills and the play button.

Pixel art is always nearest-neighbor (`image-rendering: pixelated`, `shape-rendering: crispEdges`) and scaled by whole integers only.

## Components

YAML keys are the kebab-case form of these names (e.g. Slice card → `slice-card`). Names match `EXPERIENCE.md` Component Patterns exactly.

- **Top bar** — 64px, `space-2` gradient, cyan hairline below. Left: pixel emblem + `d2t-factory` in `brand` with `dashboard · read-only` in `meta` beneath. Then the Mode badge, then (right-aligned) the Truth legend and the Reduce-motion toggle.
- **Mode badge** — 30px badge, 6px radius, `space-3` fill, `tag` type: a circle dot + `REPLAY` + `· recorded 2026-10-22` in `text-2`. [ASSUMPTION] LIVE variant: same anatomy, dot in `{colors.holo}`, text `LIVE`.
- **Truth legend** — bordered strip `LEGEND` + three Claim chips each with a plain gloss: `CLAIMED agent says so` · `VERIFIED hook fact confirms` · `UNVERIFIED no hook fact`. Always visible.
- **Reduce-motion toggle** — 34×18 switch + `Reduce motion` label. On: track `holo-2`, knob white, slid right. Focus: 2px `holo` outline, 2px offset.
- **Column header** — `column-title` uppercase in `text-2`, 1px `line` rule below, board-wide count in a small rounded pill.
- **Needs You column** — the board's center of gravity. A gold-tinted column (`gold` at 13%→5% vertical gradient, `gold` 28% side edges, inner glow) running through every lane. Its header is the **Master d2t seat**: the largest sprite (32×30 art at 4× = 128×120) on a radial gold halo with slowly rotating rays, the label `Master d2t · you` in gold, then `NEEDS YOU` in `needs-column-title` with a solid gold count pill.
- **Swimlane header** — full-width `space-3` plate, 10px radius, cyan 20% border. Row 1: conductor sprite (32px) + `Adm. Vess Korrin` / `conductor` (holo, mono) behind a divider · run-id chip (`r-7f3a`) · run title in `lane-title` · origin tag (`brownfield` / `greenfield`) · `STAGE BUILD` (stage in holo; in gold when waiting on d2t, e.g. `STAGE GATE 1`) · Budget clock. Row 2: Stage track.
- **Budget clock** — 236px. Clock glyph + `BUDGET` + `1:12` (`readout`) + `left of 2:00`. Below, an 8px meter: holo fill draining leftward with 1px dark tick segments every 6px, and a 2px gold cut marker that overshoots the track by 4px top and bottom. Caption `▲ cut point at 0:40 left` with the marker label in gold.
- **Stage track** — `INTAKE · RECON/FRAME · SCAFFOLD · SPEC∥DESIGN · ◆GATE 1 · SLICE PLAN · ◆GATE 2 · BUILD · WRAP · ◆MERGE`, joined by 1px wires (cyan behind progress, `line` ahead). Steps: done = cyan-tinted with a holo-2 square tick; now = solid holo, `on-holo` ink, glow, blinking square; future = dim `text-3`. Gates: approved = solid gold diamond + gold label; waiting = solid gold pill `GATE 1 · NEEDS YOU` with a hollow diamond in `gold-ink`; future = hollow dim diamond.
- **Stage card** — a holo-plate: hologram treatment, 6px radius, stage glyph (9×9 pixel icon at 2×) + stage name in `holo-text`, optional right-aligned meta. Wide, short, translucent — visually "a phase," not "a task." Glyphs exist for INTAKE, RECON, SCAFFOLD, SPEC, DESIGN, SLICE PLAN. [ASSUMPTION] FRAME and WRAP glyphs drawn in the same 9×9 style.
- **Slice card** — a datapad: opaque navy gradient, `card-edge` border, 8px radius, inner top highlight, a 3px left spine and two tiny status lights top-right (both `line-strong` when idle, holo with glow when an agent is working it). Slice-id chip (`S3`, mono tag) above the title in `card-title`. Optional: `meta` line, Time box meter, Claim chip, Verdict list. Compact, solid — "a task."
- **Time box meter** — `TIME BOX` left, `18 / 30 min` right (`meta`, value bold `text`), 6px holo meter below.
- **Verdict list** — under a hairline, one row per assigned reviewer: role-color dot · short name · verdict word in `tag` (`APPROVE` in `text`) + mini Claim chip, or `reviewing…` in `text-3` with a blinking ellipsis.
- **Claim chip** — 22px (18px "mini" in verdict rows), 4px radius, mono `tag` label + optional sans gloss (`tests pass`).
  - **CLAIMED** — hologram: `holo` text with cyan text-glow, scan-line fill, 60% cyan border, outer glow, irregular flicker.
  - **VERIFIED** — solid gold: `gold-hi`→`gold` gradient, `gold-ink` label, pixel seal glyph, periodic white sheen sweep; pointer cursor (opens the Evidence drawer). The word `VERIFIED` is always present, before any gloss (the mock omits it on card chips; spine wins).
  - **UNVERIFIED** — `danger` text and border on `danger-a` fill, faster flicker, gloss `no hook fact`.
- **Decision seal** — gold pixel seal glyph with drop-glow + `tag`-weight gold line naming the decision and the human: `Gate 2 · approved by Master d2t`, `intake confirmed · Master d2t`. Sits on the card the decision touched and persists into Done.
- **Needs You card** — 10px radius, warm gold-to-navy gradient, 75% gold border, faint gold scan lines, and the beacon: a gold ring that expands 14px and fades on a loop. Anatomy: Type tag + right-aligned `when` (`raised 14:36`, `ready 14:29`) · title in `needs-title` (optionally prefixed by the slice-id chip) · `REASON` block in `body-sm` with the reason category bolded · optional content (Gate 1: SPEC and DESIGN mini plates + checks like `3 assumptions to check`) · Action slot. SIGNAL LOST cards keep the gold frame but carry a danger Type tag.
- **Type tag** — 22px solid tag, 3px radius, `tag` type tracked 0.14em, blinking circle lamp: `GATE`, `ESCALATION`, `CUT`, `MERGE` on gold with `gold-ink`; `SIGNAL LOST` on `danger` with `on-danger`.
- **Action slot** — dashed gold box, 7px radius, `space-0` 55% fill. Label `> RESPOND IN TERMINAL` in gold `tag`; below, the command in a `space-0` field (`command` type, white, `$ ` prompt in `text-3`) and a 30×30 gold-outlined Copy button with a pixel copy glyph. The slot's footprint is reserved for a future action button.
- **Agent sprite** — pixel character + name (`label`, `text`) + role label (`meta`, `holo`, prefixed by the 6px role-color dot); Kael's role label uses `role-reviewer-security-text`. A cyan elliptical holo-pad glows under the feet. Agents stand above the card they work (overlapping its top edge), cluster around a card in review (two above, two below), or sit beside a Needs You card when standing by (horizontal "side" layout). See Pixel sprites below.
- **Done stack** — newest first. When a lane's Done cell holds more than five items, the four newest stay visible and the rest collapse into a deck: `+3` (bold, `holo-text`) + the collapsed names (`INTAKE · RECON · SCAFFOLD`), drawn with two offset edge lines suggesting stacked cards. Seals stay visible on visible cards.
- **Empty cell** — dashed 25% cyan border, 8px radius, three ghost datapads (hologram outlines, the middle one raised 3px), a mono title (`AWAITING GATE 1`, `holo-text-2`) and a one-line explanation (`Slices are dealt here once the slice plan clears Gate 2.`, `text-3`). Columns that are simply idle stay blank.
- **Evidence drawer** — docked 320px panel, `space-2` gradient, gold 40% left edge, 3px gold top bar. Head: kicker `EVIDENCE DRAWER`, title `Evidence · S1 tests pass · VERIFIED` (state word in its state color), 28px close button `×`. Hero: large seal + `VERIFIED` + `A hook fact matched Brix's claim.` on a gold-tinted plate. `HOOK FACT` table (92px mono key column): event · command · exit code (gold `0` badge) · timestamp · session. `CLAIM → PROOF` chain: cyan node `CLAIMED by Brix 14:02:09 · "tests pass"` → gradient line → gold node `VERIFIED by hook 14:02:11 · exit code 0`, plus the one-line summary. Note with gold left rule: **Agents can claim. Only a hook fact can verify.** Footer: card and run reference. While open, the source card shows a 2px gold outline and an `EVIDENCE ▸` tab.
- **Replay bar** — sticky 86px footer. `prev decision` / play-pause (44px round, cyan rim) / `next decision` buttons · `SPEED` segmented `1× 4× 16×` (active segment solid holo) · timeline: 6px track with cyan played portion, gold diamond pips per human decision (dim brown for future ones), mono labels alternating above/below (`Gate 1 · r-7f3a`, `intake · r-2c91`), white playhead line with a cyan knob · `REPLAY TIME 00:47:12 / 01:38:40` in `readout-lg`.
- **Starfield** — three repeating star layers (1px, 1.5px, 2px; 55–70% opacity) drifting left at different speeds over the nebula washes. Behind everything; never interactive.

### Pixel sprites

| Rule | Spec |
|---|---|
| Final art | 32×32 px, integer scale 2× / 3×, nearest-neighbor. [ASSUMPTION] Board placement: board agents 2× (64px); Master d2t keeps its 128px seat; lane-header conductor fits the 32px slot. |
| Palette | Shared 20-color palette (`sprite-*` tokens: 16 core + 4 accents). No off-palette pixels. |
| Light | Single source, top-left. Highlight on top/left edges, shade bottom/right. |
| Animation | 4-frame idle + 4-frame walk per character, plus at most one signature effect. |
| Current placeholders | 16×16 inline SVG, 2-frame idle (stepped 3px bob) + per-character effect frames; rendered 3× (48px) on the board, 2× (32px) in lane headers; Master d2t 32×30 at 4×. Replaced wholesale by the separate image-generation project. |
| Accessibility | Sprites are decorative (`aria-hidden`); the name and role label beside them are real text. |

### Character roster

All original characters, Old Republic in spirit. Name + role label always visible.

| Name (short) | Role | Look | Role color | Signature on board |
|---|---|---|---|---|
| Master d2t | human operator (Jedi Master) | Hooded brown robe, gold trim | `{colors.role-d2t}` gold | Largest sprite, seated atop Needs You under a halo; periodically looks up |
| Admiral Vess Korrin (`Adm. Vess Korrin`) | conductor | Naval officer, grey uniform | — (label in `{colors.holo}`) | Lives in every Swimlane header; slow bob, 2s effect cycle |
| Brix | builder | Armored engineer, welding sparks | `{colors.role-builder}` steel | Rapid spark flicker at the torch |
| Sela Venn | designer | Holo-architect | `{colors.role-designer}` violet | 2-frame working effect, 1.1s cycle |
| Archivist Tarvus (`Tarvus`) | reviewer-code | Grey-bearded scholar with datapad | `{colors.role-reviewer-code}` sage | 2-frame working effect, 0.7s cycle |
| Kael Nox | reviewer-security | Reformed Sith, red visor | `{colors.role-reviewer-security}` crimson | Visor scan sweep, drifting embers, crimson aura, dashed standby pad |
| Mira Sol | reviewer-ux | Impatient smuggler-pilot | `{colors.role-reviewer-ux}` pink | 2-frame working effect |
| P-11 "Pell" (`Pell`) | reviewer-a11y | Protocol droid | `{colors.role-reviewer-a11y}` silver | Photoreceptor blink |
| Envoy Quill (`Quill`) | reviewer-ui | Image-obsessed diplomat | `{colors.role-reviewer-ui}` teal | 2-frame working effect, 1.6s cycle |

## Do's and Don'ts

| Do | Don't |
|---|---|
| Original characters, names, and gear in an Old Republic *spirit* | **Use any Star Wars name, species, character likeness, logo, ship, or catchphrase — hard rule, no exceptions** |
| Gold for d2t and only d2t: decisions, seals, Needs You, gates, pips, VERIFIED | Gold on agent activity, decoration, or hover |
| Cyan for agents and CLAIMED | Cyan on anything the human decided |
| Red-orange `danger` only for UNVERIFIED and SIGNAL LOST | Red-orange for emphasis, branding, record dots, or Kael (he is crimson) |
| Pair every state color with its text label (`CLAIMED`, `VERIFIED`, `UNVERIFIED`, `SIGNAL LOST`, `AT RISK`) | Let color or a seal glyph alone carry a state |
| Keep decision seals on cards forever, including Done | Fade, collapse away, or hide a seal when a card ages |
| Diamonds for human decisions only | Diamonds as generic bullets or status icons |
| Integer-scaled, nearest-neighbor pixel art from the shared palette | Smoothed, fractionally scaled, or off-palette sprites |
| Name + role label beside every sprite | A sprite without readable text |
| 11px minimum, mono tags only; reading text ≥13px | Shrink text to fit more cards |
| Dock the evidence drawer and narrow the board | Overlay the drawer on cards |
| Light-mode ideas parked for after the POC | Ship a light theme or a partially themed light mode |
