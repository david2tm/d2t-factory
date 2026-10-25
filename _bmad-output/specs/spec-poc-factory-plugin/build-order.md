# Build Order

Built with BMad. The dashboard is part of building the factory, not the factory's first job. Every increment ends demoable.

| # | Increment | Capabilities |
|---|---|---|
| 0 | **Spike** — see below | de-risks CAP-9, CAP-12, CAP-14 |
| 1 | Walking skeleton: brownfield, one run in one worktree, spec → builder → reviewer-code → human OK; ships the minimum truth slice (state machine, CLI, human-command, Stop, session-start, write-guard and fact hooks); stub intake and single-slice plan, still gated by `approve intake` and gate 2; recording at WRAP | CAP-1, 3, 4, 5, 12 (single run), 13, 14 (partial), 16 (record) |
| 2 | Dashboard | CAP-14, 15 |
| 3 | Full loop, reviewer charter, all reviewers, designer, slices, budget clock | CAP-2, 6, 7, 8, 9, 10, 11 |
| 4 | Replay engine on single-run recordings from increments 1–3 | CAP-16 (single-run) |
| 5 | Parallel runs, record multi-run session, greenfield path | CAP-12 (parallel), CAP-16 (multi-run), CAP-3 greenfield |

Increment 1 carries the truth slice because every gate and merge depends on hook-observed human commands. Multi-run replay depends on increment 5 — recordings of parallel runs cannot exist before parallel runs do.

**Timed dry run** on an unseen brownfield repo validates the tabletop timings.

## Spikes

`ARCHITECTURE-SPINE.md` Open Questions is the authority: each spike has a build-on default, a pass criterion, and a fallback. Closed or dropped since the spec's first pass:

- Env var inheritance into hooks, plugin `agent_type` naming — closed by research (session id passed by the conductor; plugin agents namespaced).
- Plugin `WorktreeCreate` hook — dropped; the CLI creates worktrees (`pipeline-stages.md`).

Stop-hook blocking still has no fallback; CAP-14 depends on it.

Increment-0 verdicts and evidence: [`spike-results.md`](spike-results.md).

## Timing evidence (tabletop, unvalidated)

Brownfield interview: intake + recon + scaffold + spec/design + gates ≈ T+35–40; per slice ≈ 18–22 min clean, 25–30 with one rework; 3 slices → T+110–130 incl. wrap.

Known bottlenecks: serial review rounds (pipelining only helps independent slices, and only for diff reviewers); per-reviewer dev servers; long specs at the human gate; Opus everywhere; unbudgeted interviewer interruptions or scope change; repo setup (DB/env) failures at SCAFFOLD — the largest sink. Mitigations in scope: pipelined reviews for independent slices, one shared dev server, one-screen spec, Sonnet reviewers, budget clock, slice time box.
