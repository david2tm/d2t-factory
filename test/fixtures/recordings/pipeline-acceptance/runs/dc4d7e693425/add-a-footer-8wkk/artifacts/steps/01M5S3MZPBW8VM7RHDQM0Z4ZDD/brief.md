# Brief — d2t-factory:reviewer-code
step 01M5S3MZPBW8VM7RHDQM0Z4ZDD · stage BUILD · attempt 1

## Facts
- task: add a footer
- run: add-a-footer-8wkk (branch factory/add-a-footer-8wkk, base b28966fcdd19b2c2015c6b86262d35ab46049b1a)
- claimed port: 5100
- worktree: /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/repo/.claude/worktrees/factory-add-a-footer-8wkk
- slice: S1 add a footer
- acceptance criteria of S1: AC-1, AC-2
- tags of S1: none
- review this diff: git diff b28966fcdd19b2c2015c6b86262d35ab46049b1a..a3f2b2087fc055347435bacdbd4662d414735b26 (run it in the worktree; its tests pass at a3f2b2087fc055347435bacdbd4662d414735b26)
- S1's own commits: 0984087ec8451634d21516295445bc5321573922, a3f2b2087fc055347435bacdbd4662d414735b26. Review only the changes these commits make (`git show <commit>`); the rest of that diff is other slices' work, context only: report no finding on it
- read the code at a3f2b2087fc055347435bacdbd4662d414735b26: `git show a3f2b2087fc055347435bacdbd4662d414735b26:<path>`, never from the working tree, which may hold another slice's work in progress
- no other slice is being built in the worktree right now: you may run the tests (they passed at a3f2b2087fc055347435bacdbd4662d414735b26)

## Read only these inputs
- repo context from RECON: /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/recon/b28966fcdd19b2c2015c6b86262d35ab46049b1a.md
- the approved spec (pinned at gate 1): /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/runs/add-a-footer-8wkk/artifacts/steps/01M5S3MTHYF48JSBNGWB5ZE30R/out.md
- the worktree (product code): /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/repo/.claude/worktrees/factory-add-a-footer-8wkk

## Write exactly one file
/private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/runs/add-a-footer-8wkk/artifacts/steps/01M5S3MZPBW8VM7RHDQM0Z4ZDD/out.md
Write it with the Write tool. Write nothing else under ~/.factory, and never run `factory`.

## Output format
Line 1 is your verdict: `VERDICT: APPROVE` when nothing must change, or `VERDICT: FINDINGS` followed by one fenced block per finding:
````
VERDICT: FINDINGS

```finding
category: Bug
location: src/footer.js:12
failure_scenario: On a page without <main>, render() throws and the page is blank.
```
````
The charter: report a finding only with a concrete failure scenario, and only in one of these categories: Bug, Spec miss, Security, Breakage (Spec miss = an acceptance criterion not met; Security = a real exploit path; Breakage = failing tests or a convention a maintainer would reject). No nitpicks: every finding is must-fix. `APPROVE` has no finding block; `FINDINGS` has at least one. Inside a block: category, location (`<path>:<line>`) and failure_scenario, one per line, in that order.
The factory may restart the dev server while you review: don't rely on it (the slice's tests already passed).
Or, when you cannot review, line 1 `VERDICT: ESCALATE` and line 2 `<Label>: <one line why>` (labels: Scope change, Spec ambiguity, Irreversible action, New dependency, Non-convergence, Over time box, Taste disagreement).
