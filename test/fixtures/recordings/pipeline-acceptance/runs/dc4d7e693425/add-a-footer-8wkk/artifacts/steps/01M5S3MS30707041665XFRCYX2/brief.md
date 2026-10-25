# Brief — d2t-factory:scaffolder
step 01M5S3MS30707041665XFRCYX2 · stage SCAFFOLD · attempt 1

## Facts
- task: add a footer
- run: add-a-footer-8wkk (branch factory/add-a-footer-8wkk, base b28966fcdd19b2c2015c6b86262d35ab46049b1a)
- claimed port: 5100
- worktree: /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/repo/.claude/worktrees/factory-add-a-footer-8wkk

## Read only these inputs
- repo context from RECON: /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/recon/b28966fcdd19b2c2015c6b86262d35ab46049b1a.md
- the worktree (product code): /private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/repo/.claude/worktrees/factory-add-a-footer-8wkk

## Write exactly one file
/private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/runs/add-a-footer-8wkk/artifacts/steps/01M5S3MS30707041665XFRCYX2/out.md
Write it with the Write tool. Write nothing else under ~/.factory, and never run `factory`.

## Output format
Line 1 `STATUS: DONE`, then the run contract as front matter (JSON for lists and for strings with spaces):
```
STATUS: DONE
---
install: "npm ci"
add: "npm install --save-exact"
start: "npm run dev"
url: "http://localhost:<port>"
port: <port>
test: "npm test"
health: "curl -fsS http://localhost:<port>/"
copy_gitignored: [".env"]
services: [{"name": "postgres", "shared": true}]
---
```
`port` must be exactly the claimed port above, and `start` must read it from the PORT environment variable. `health` is a command (or an http URL) that succeeds once the app serves. `copy_gitignored` lists the gitignored files (like `.env`) the app needs; the CLI copies them. Install nothing and change no tracked file: this is a brownfield repo.
Or, when you cannot do the job, line 1 `STATUS: ESCALATE` and line 2 `Scaffold failed: <one line why>` (labels: Scope change, Spec ambiguity, Irreversible action, New dependency, Non-convergence, Over time box, Taste disagreement, Scaffold failed).
