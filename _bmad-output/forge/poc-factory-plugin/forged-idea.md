# Forged idea: d2t-factory — POC software factory plugin for Claude Code

**Purpose.** Slimmed-down BMad for fast POCs and 1.5–2h interview exercises (add a feature to an unseen repo, or start from scratch). The interview showcases d2t's mastery of *driving* Claude Code; the factory is the evidence, so every surface foregrounds human decisions.
**Built with BMad; runs standalone** in projects without BMad. Shipped as a plugin, installed user-level; nothing lands in the project.

## Process
`INTAKE (brainstorm) → FRAME (greenfield) | RECON (brownfield) → SCAFFOLD → SPEC ∥ DESIGN → [gate] → SLICE PLAN → [gate] → BUILD LOOP per slice → WRAP → [human merge OK]`
- `/factory [optional task]` = conductor; `/factory` alone resumes from disk. Per-stage skills re-runnable; `/factory rework <note>`.
- SCAFFOLD emits a run contract (install, start, URL/port, test cmd, health). Greenfield creates the project + its own test runner; brownfield installs nothing, verifies, pages human if broken. One dev server per run, shared by reviewers.
- Spec fits one screen; acceptance criteria each carry a command/page check; `Assumptions` section is checked for product decisions.
- Budget clock: ~1:20 the conductor proposes cutting remaining slices (a gate).

## Build loop
- Builder (Opus, resumed via SendMessage) + reviewers (Sonnet), pipelined: slice N reviewed while builder starts N+1.
- One file per agent, first-line verdict (`VERDICT`, `STATUS`, `APPROVE|ESCALATE`).
- **Reviewer charter:** report only with a concrete failure scenario, in Bug / Spec miss / Security (real exploit path) / Breakage (brownfield). No nitpicks, no notes tier. All findings must-fix; max 2 retrigger rounds per slice.
- **Roster:** code always; security on input/auth/secrets/external slices; ux + a11y on UI slices against the running app; ui on UI slices against a reference (designer output or repo design system). Tags per slice; human override at intake.
- **Designer:** one `design.md` (DESIGN.md tokens + Components / States / A11y floor). Inherit (brownfield, no questions) or invent (greenfield, UI-system defaults, max one question). ~10 min, parallel to SPEC, approved at SPEC gate.

## Human escalation (only these)
1. Scope/intent change or spec ambiguity that forks the code. 2. Irreversible/outward: migrations, deleting code outside slice, secrets/network/deploy; new deps only in brownfield. 3. Non-convergence: same finding bounced twice, or slice over time box. 4. Taste disagreement (correctness → tests decide).

## Worktrees & merge
- Worktree at first write (native `claude --worktree`); intake/recon/spec read-only in main checkout. Per-run id, port, atomic `mkdir` claim.
- Merge always needs explicit human OK (PR or local merge). Factory resolves conflicts, re-runs tests + reviewer-code before asking.

## Truth layer & dashboard (own build, minimal, no Docker)
- Facts from async plugin hooks (subagent start/stop with agent_type, tool success/failure, tests). Semantics only via a factory CLI **state machine** (rejects illegal transitions; gate pass verifies evidence); Stop hook blocks ending in non-terminal state.
- Session→run registry; unregistered sessions dropped. Per-writer JSONL at `~/.factory/<repo-hash>/runs/` = source of truth; SQLite rebuildable cache; SSE to browser. Shows claimed vs verified. Liveness via heartbeat + `claude agents --json`. WRAP snapshots + redacts transcripts.
- **Parallelism is shown via replay of a real recorded multi-run session, never live.**

## Build order
1 skeleton (brownfield, one run, spec→builder→reviewer-code→human OK) · 2 truth layer + dashboard · 3 full loop, charter, reviewers, designer, slices · 4 replay · 5 worktrees/parallel + greenfield.
Spike first: env var inheritance into hooks; plugin `agent_type` naming; sandboxed writes to `~/.factory`; agent-browser vs Playwright MCP.

## Rejected
- Fork agents-observe (Docker, server-first, no pipeline semantics). OTel as dashboard source (can't name custom agents, no worktree identity). Tooling in project deps. Approver auto-merging. Nitpick/notes tier. Two separate pipelines. Running parallel worktrees live in an interview. `.factory/` state inside the repo.

## Borrowed (credit openly: ZazenCodes software-factory-claude-code)
File-per-agent verdict protocol, spec Assumptions, criteria with checks, resumed builder, `agent-browser --session`, atomic claim, rework command, model routing by role.

## Open
- Simulation fits 2:00 marginally, not 1:30 — measure on a dry run before trusting the timings.
- Next interview date unknown; build-order scope vs deadline unvalidated.
- d2t must explain in their own words why the dashboard is truthful.
