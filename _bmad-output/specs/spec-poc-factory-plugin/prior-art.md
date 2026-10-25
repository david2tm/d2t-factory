# Prior Art

## ZazenCodes software-factory-claude-code — credit openly

Shape: 1 skill + 7 agents (spec-writer, builder, 4 reviewers, approver); `job.json` per job; worktrees at `../<repo>-factory/<id>`; per-job ports; agent-browser CLI; polling `dashboard.html`; backlog + `/factory next|approve|rework`; MAX_RESUMES=2; approver auto-merges or escalates.

**Borrowed:** one-file-per-agent first-line verdict protocol; spec Assumptions section; acceptance criteria with checks; resumed builder; `agent-browser --session`; atomic `mkdir` claim; `/factory rework <note>`; model routing by role.

**Differentiators (lead with these):** brainstorm-first intake; RECON + run contract for never-seen repos; slices; human OK on every merge (no auto-merge approver); hook-verified dashboard (claimed vs verified); shipped as a plugin; greenfield path; a11y lens.

## simple10/agents-observe

Plugin; hooks → server → SQLite; Docker; no worktree or pipeline semantics. Patterns borrowed, code not forked.

## disler observability demo

Drops events when the server is down — reason the JSONL log needs no collector running.
