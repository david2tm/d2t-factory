# Brief — d2t-factory:builder
step 01M5S3MX13FS210EH2SRW19KNM · stage BUILD · attempt 1

## Facts
- task: add a footer
- run: add-a-footer-8wkk (branch factory/add-a-footer-8wkk, base b28966fcdd19b2c2015c6b86262d35ab46049b1a)
- claimed port: 5100
- worktree: /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/repo/.claude/worktrees/factory-add-a-footer-8wkk
- slice: S1 add a footer
- acceptance criteria of S1: AC-1, AC-2
- tags of S1: none

## Read only these inputs
- repo context from RECON: /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/recon/b28966fcdd19b2c2015c6b86262d35ab46049b1a.md
- the approved spec (pinned at gate 1): /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/runs/add-a-footer-8wkk/artifacts/steps/01M5S3MTHYF48JSBNGWB5ZE30R/out.md
- run contract from SCAFFOLD: /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/runs/add-a-footer-8wkk/artifacts/steps/01M5S3MS30707041665XFRCYX2/out.md
- the worktree (product code): /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/repo/.claude/worktrees/factory-add-a-footer-8wkk

## Write exactly one file
/private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/runs/add-a-footer-8wkk/artifacts/steps/01M5S3MX13FS210EH2SRW19KNM/out.md
Write it with the Write tool. Write nothing else under ~/.factory, and never run `factory`.

## Output format
Implement the slice in the worktree, then write line 1 `STATUS: DONE` and this front matter:
```
STATUS: DONE
---
summary: "Added the footer component to the main page, with a test"
---
<optional notes for the reviewer>
```
Edit only files inside the worktree. Never commit, never run git commands that change history, never start servers: the factory commits your work and runs the tests. Install a dependency only with the run contract's `add` command.
Or, when you cannot do the job, line 1 `STATUS: ESCALATE` and line 2 `Spec ambiguity: <one line why>` (labels: Scope change, Spec ambiguity, Irreversible action, New dependency, Non-convergence, Over time box, Taste disagreement).
