# Brief — d2t-factory:slicer
step 01M5S3MVS9PY5Q6DKF3RN40J59 · stage SLICE_PLAN · attempt 1

## Facts
- task: add a footer
- run: add-a-footer-8wkk (branch factory/add-a-footer-8wkk, base b28966fcdd19b2c2015c6b86262d35ab46049b1a)
- claimed port: 5100
- worktree: /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/repo/.claude/worktrees/factory-add-a-footer-8wkk

## Read only these inputs
- repo context from RECON: /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/recon/b28966fcdd19b2c2015c6b86262d35ab46049b1a.md
- the approved spec (pinned at gate 1): /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/runs/add-a-footer-8wkk/artifacts/steps/01M5S3MTHYF48JSBNGWB5ZE30R/out.md
- the worktree (product code): /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/repo/.claude/worktrees/factory-add-a-footer-8wkk

## Write exactly one file
/private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/runs/add-a-footer-8wkk/artifacts/steps/01M5S3MVS9PY5Q6DKF3RN40J59/out.md
Write it with the Write tool. Write nothing else under ~/.factory, and never run `factory`.

## Output format
Line 1 `STATUS: DONE`, then the plan as front matter: one `slices` line holding a single-line JSON list, then a short rationale:
```
STATUS: DONE
---
slices: [{"id": "S1", "title": "Signup form", "acs": ["AC-1", "AC-2"], "tags": ["ui", "input"], "depends_on": []}, {"id": "S2", "title": "Welcome mail", "acs": ["AC-3"], "tags": [], "depends_on": ["S1"]}]
---
S2 sends the mail S1's form triggers.
```
Slices are S1, S2, … in build order, each small enough to build and review on its own. `acs` lists only the spec's acceptance criteria, and every one of them is in some slice. `depends_on` names only earlier slices; leave it empty for an independent slice. `tags` only from ui, input, auth, secrets, external: ui (a page or component a user sees), input (it parses user or request input), auth (sign-in, sessions, permissions), secrets (keys, tokens, credentials), external (it calls a service outside the app). Tag what the slice touches, nothing else: the factory derives the reviewers from the tags.
Or, when you cannot do the job, line 1 `STATUS: ESCALATE` and line 2 `Spec ambiguity: <one line why>` (labels: Scope change, Spec ambiguity, Irreversible action, New dependency, Non-convergence, Over time box, Taste disagreement).
