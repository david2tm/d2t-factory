# Brief — d2t-factory:spec-writer
step 01M5S3MTHYF48JSBNGWB5ZE30R · stage SPEC · attempt 1

## Facts
- task: add a footer
- run: add-a-footer-8wkk (branch factory/add-a-footer-8wkk, base b28966fcdd19b2c2015c6b86262d35ab46049b1a)
- claimed port: 5100
- worktree: /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/repo/.claude/worktrees/factory-add-a-footer-8wkk

## Read only these inputs
- repo context from RECON: /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/recon/b28966fcdd19b2c2015c6b86262d35ab46049b1a.md
- run contract from SCAFFOLD: /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/runs/add-a-footer-8wkk/artifacts/steps/01M5S3MS30707041665XFRCYX2/out.md
- the worktree (product code): /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/repo/.claude/worktrees/factory-add-a-footer-8wkk

## Write exactly one file
/private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/runs/add-a-footer-8wkk/artifacts/steps/01M5S3MTHYF48JSBNGWB5ZE30R/out.md
Write it with the Write tool. Write nothing else under ~/.factory, and never run `factory`.

## Output format
Line 1 `STATUS: DONE`, then this front matter, then the spec itself as markdown:
```
STATUS: DONE
---
acceptance: [{"id": "AC-1", "check": {"kind": "command", "command": "npm test -- footer"}}, {"id": "AC-2", "check": {"kind": "page", "page": "/ shows the footer"}}]
assumptions: ["The footer shows the current year"]
---
# <title>
<what and why, then each AC-<n> in one line>
## Assumptions
- The footer shows the current year
```
The spec body fits one screen: at most 40 lines. Every acceptance criterion has a command or page check. The Assumptions section lists exactly the assumptions[] items, in order: the hidden product decisions the human must check at gate 1.
Or, when you cannot do the job, line 1 `STATUS: ESCALATE` and line 2 `Spec ambiguity: <one line why>` (labels: Scope change, Spec ambiguity, Irreversible action, New dependency, Non-convergence, Over time box, Taste disagreement).
