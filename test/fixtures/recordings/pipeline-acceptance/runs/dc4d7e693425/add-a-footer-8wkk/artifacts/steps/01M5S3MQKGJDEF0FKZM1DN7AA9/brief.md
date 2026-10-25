# Brief — INTAKE (the conductor)
step 01M5S3MQKGJDEF0FKZM1DN7AA9 · stage INTAKE

## Facts
- task: add a footer
- run: add-a-footer-8wkk (branch factory/add-a-footer-8wkk, base b28966fcdd19b2c2015c6b86262d35ab46049b1a)

## Agree these with the human, in chat
Ask in one short message, then end the turn and wait for the answer; no spec file exists until the human confirms. Settle these, and anything else the human stresses about the task:
- `limit_min`: the time limit for the whole exercise, in minutes (2:00 is 120).
- `started`: when the exercise started, if before this run, as a JSON string in ISO-8601 with its zone (UTC `Z` or `±hh:mm`); leave it out otherwise. The budget clock runs from the earlier of that and the run start, and never pauses; at limit − 40 min with slices unbuilt the human is asked what to cut.
- `slice_timebox_min`: the time box per slice, in minutes (30 when the human has no preference).
- `ui_free`: true when the task touches no UI, so no designer and no UI reviewers run.
- `reviewer_overrides`: run-wide changes to the reviewer roster: `add` and `remove` among reviewer-security, reviewer-ux, reviewer-a11y, reviewer-ui. reviewer-code always runs.

## Write exactly one file
/private/var/folders/75/r0vpxwpn6jj5b24d5_5hn5hw0000gn/T/factory-pipe-TaJzw6/.factory/dc4d7e693425/runs/add-a-footer-8wkk/artifacts/steps/01M5S3MQKGJDEF0FKZM1DN7AA9/out.md
Write it with the Write tool, and nothing else under ~/.factory.

## Output format
```
STATUS: DONE
---
limit_min: 120
slice_timebox_min: 30
ui_free: false
reviewer_overrides: {"add": [], "remove": []}
---
<the task as agreed, constraints, anything the human stressed>
```
One `key: value` per line; JSON for the object and for quoted strings. Add a `started` line only when the exercise began before this run.

## Then
Run `factory done` with this step's step_id from `next`. A MISSING_EVIDENCE answer names what to fix: fix the file and run the same done again. The CLI then shows the human a confirm card with the four fields. If the human changes anything before approving, rewrite the file and run `factory done` with the step_id the last done returned.
