# Review Policy

## Reviewer charter

- Report a finding **only** with a concrete failure scenario.
- Categories (nothing else is reportable):
  - **Bug**
  - **Spec miss** — an acceptance criterion not met
  - **Security** — with a real exploit path
  - **Breakage** (brownfield) — failing tests, or a convention a maintainer would reject
- No nitpicks, no notes tier — minor findings are not generated or logged.
- Every reported finding is must-fix.
- Max 2 builder retrigger rounds per slice.
- Correctness disputes are decided by tests, not argument.

## Roster and selection

| Reviewer | Runs when | Judges |
|---|---|---|
| reviewer-code | Always | Diff |
| reviewer-security | Slice tagged input / auth / secrets / external | Diff |
| reviewer-ux | UI-tagged slice | Running app |
| reviewer-a11y | UI-tagged slice | Running app (objective failures) |
| reviewer-ui | UI-tagged slice **and** a reference exists (`design.md`, repo component library/design system, or UI kit chosen in FRAME) | Running app vs reference |

- No reference → reviewer-ui's broken-rendering checks fold into reviewer-ux.
- Tags are set per slice in SLICE PLAN; human can override at INTAKE.
- Browser automation: repo's own e2e tooling when present, else plugin-shipped driver.

## Human escalation — only these

1. Scope/intent change, or spec ambiguity that forks the code.
2. Irreversible or outward action: migrations, deleting code outside the slice, secrets / network / deploy. New dependencies page **only in brownfield**.
3. Non-convergence: same finding bounced twice, or slice over its time box (default 30 min, set at INTAKE).
4. Builder/reviewer taste disagreement.

## Every human ask — closed list

| Ask | Kind |
|---|---|
| Intake confirm, gate 1, gate 2, budget-clock cut, merge OK | Planned gate |
| Escalation conditions 1–4 (above) | Escalation |
| SCAFFOLD failure (project won't install/start/test) | Declared ask |
| Designer's one question (invent mode) | Declared ask |
| Resume selection (several live runs) | Declared ask |

Planned gates and declared asks are not escalations. Anything not in this table never reaches the human; lost liveness is a dashboard-only notice. Chat and dashboard show each ask with the same title, reason, and commands.
