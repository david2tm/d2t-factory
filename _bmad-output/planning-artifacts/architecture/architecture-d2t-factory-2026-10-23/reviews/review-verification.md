---
review: verification (reality-check of committed decisions)
target: ../ARCHITECTURE-SPINE.md
date: 2026-10-23
reviewer-lens: every committed decision web-researched or reality-checked, not asserted from training data
environment: macOS (Darwin 25.6.0), Claude Code 2.1.309, Node v26.11.1
---

# Verification review: d2t-factory architecture spine

## Method

- **Docs.** I read the docs at code.claude.com (hooks, plugins-reference, plugins/components, plugins/loading, skills, worktrees, tools-reference) and at nodejs.org (sqlite, typescript, previous-releases, and the July and October 2026 security advisories). I fetched the raw hooks markdown with `curl https://code.claude.com/docs/en/hooks.md` and searched it with grep.
- **Live probe.** I built a throwaway plugin named `d2t-factory` in the scratchpad. Its skill was `skills/factory` with `name: factory`. Its `bin/factory-env` dumped its environment. Logging hooks covered UserPromptExpansion, UserPromptSubmit, WorktreeCreate, WorktreeRemove, Stop, an async PostToolUse and PostToolUseFailure. I ran it with `claude -p --plugin-dir … --model haiku` in a scratch git repo.
- **Local commands.** `claude agents --json`, Node type-stripping probes, a recursive `fs.watch` probe, `npm pack svelte@5.57.2`, `npx agent-browser@0.39.2 --help`, `npx typescript@7.0.2 tsc --help --all` and `npm view` for the peer ranges.
- **Clean-up.** I deleted the empty `~/.claude/plugins/data/d2t-factory-inline` directory that the probe created. Everything else stayed in the scratchpad.

Items the author already verified (listed in the memlog) were not re-checked, except where a probe happened to observe them again.

## Summary

| Status | Count |
| --- | --- |
| Contradicted (the spine is wrong, or relies on behavior the platform doesn't have) | 5 |
| Confirmed with a gap (the claim holds, but the spine misses a constraint that changes the design) | 8 |
| Confirmed | 12 |
| Unverifiable | 3 |
| **Total** | **28** |

---

## Contradicted

### V-01: The WorktreeCreate hook can't "handle `factory-*` names and replicate default git placement for other names" without changing every other session (AD-15, AD-13, memlog constraint)

- **Claim.**
  - The plugin's `WorktreeCreate` hook places `factory-*` names under `~/.factory/<hash>/worktrees/<run-id>`. Any other name gets the default `git worktree` placement.
  - Hooks are invisible outside the factory (AD-13). The spine constraint says "Factory worktree hooks never alter non-factory worktree sessions".
- **Status.** Contradicted.
- **Evidence.**
  - hooks.md, `### WorktreeCreate`: the event fires for `claude --worktree`, for `EnterWorktree`, for a subagent with `isolation: "worktree"`, for workflow agents, for background sessions and for `remote-control` worktree mode. *"Configuring a WorktreeCreate hook replaces that default git behavior … Because the hook replaces the default behavior entirely, `.worktreeinclude` is not processed."* *"If the hook fails or produces no path, worktree creation fails."* WorktreeCreate is listed under "no matcher support".
  - A user-level plugin therefore owns **every** worktree creation in **every** repo and session. The hook can't "exit 0 silently" for non-factory sessions as AD-13 requires, because printing no path makes the creation fail.
  - "Default placement" covers more than the path, per worktrees.md:
    - the `.claude/worktrees/<name>` path and the `worktree-<name>` branch
    - `worktree.baseRef` fresh/head, including the background fetch of `origin/HEAD` capped at 5 s
    - `--worktree "#1234"` PR/MR fetches
    - reopening and resetting a reused name
    - `.worktreeinclude`
    - neutralising filter drivers and LFS
    - `git worktree lock` while an agent runs
    - a Claude Code marker written into git metadata, which the periodic sweep requires
  - The marker and the lock semantics are internal and can't be replicated faithfully.
  - Further side effects that the docs confirm:
    - *"When a subagent or a workflow agent finishes, Claude Code keeps the worktree your WorktreeCreate hook made for it and doesn't run your WorktreeRemove hook."*
    - The sweep *"keeps any worktree without [the marker], including a worktree a WorktreeCreate hook created."*
    - *"Claude Code never deletes a branch belonging to a hook-created worktree."*
    - Installing the plugin would therefore silently stop the auto-cleanup of subagent worktrees across the user's machine.
  - Probe: `EnterWorktree name=factory-abc12` fired the hook with `{"hook_event_name":"WorktreeCreate","name":"factory-abc12", "cwd":<main repo>}`, and the path outside the repo was accepted. The mechanism works, but its scope is global.
- **Suggested spine fix.**
  - Drop the plugin `WorktreeCreate` and `WorktreeRemove` hooks.
  - The CLI creates the worktree itself, from `factory start` or the `enter_worktree` step: `git worktree add ~/.factory/<hash>/worktrees/<run-id> -b factory/<slug>`, plus copying the gitignored files.
  - The step then tells the conductor to call `EnterWorktree` with **`path`** (see V-14).
  - Probe: `EnterWorktree path=<external git worktree>` entered it on branch `factory/demo` without error. The run was in bypass mode. In other modes, a path outside `.claude/worktrees/` shows one approval prompt.
  - Keep the spec's `.claude/worktrees/` + `.git/info/exclude` fallback.
  - Remove `WorktreeCreate`/`WorktreeRemove` from AD-13's list of synchronous hooks, and drop the AD-13 exception for a "WorktreeCreate failure for a `factory-*` name".

### V-02: UserPromptExpansion's `prompt` is not verbatim, and `command_name` is namespaced (AD-6, the UX Decision drawer "terminal response (verbatim)")

- **Claim.** The `UserPromptExpansion` hook writes a `human_prompt` fact holding the verbatim `prompt`, `command_name` and `command_args`. The commands are bare `/factory …`.
- **Status.** Contradicted. The bare invocation itself works.
- **Evidence.** Probe: the user typed `/factory approve gate1`.
  - UserPromptExpansion: `"command_name":"d2t-factory:factory"`, `"command_args":"approve gate1"`, `"command_source":"plugin"`, `"prompt":"/d2t-factory:factory approve gate1"`. The prompt was rewritten to the namespaced form.
  - UserPromptSubmit: `"prompt":"/factory approve gate1"`. This is the actual verbatim text, with the same `prompt_id`.
  - Bare `/factory` resolved because the frontmatter set `name: factory`. skills.md: *"The bare `/fancy` also invokes the skill unless another command already uses that name."* Without `name`, only `/d2t-factory:factory` is guaranteed.
  - hooks.md: matchers on plugin-scoped names containing `:` use the regex path, so they must be anchored (`^d2t-factory:factory$`).
- **Suggested spine fix.**
  - AD-6: match `command_name == "d2t-factory:factory"` and parse `command_args`.
  - If the UX needs the text exactly as typed, take it from the `UserPromptSubmit` fact joined on `prompt_id`, which then becomes a synchronous hook too. Otherwise, relabel the drawer field as "normalized command".
  - Consistency Conventions: `skills/factory/SKILL.md` **must** set `name: factory`. Document `/d2t-factory:factory …` as the guaranteed fallback spelling, because a user or project command named `factory` would shadow the bare form. The reducer must accept both spellings.
  - Use the anchored matcher `^d2t-factory:factory$`.

### V-03: The CLI has no `${CLAUDE_PLUGIN_DATA}`, `CLAUDE_PLUGIN_ROOT` or `userConfig` values (AD-19, AD-16, AD-14, Config convention)

- **Claim.**
  - The first `factory dashboard` runs `npm ci` and the build into `${CLAUDE_PLUGIN_DATA}`.
  - `dashboard_port` comes from plugin `userConfig`, and the CLI starts the dashboard on it.
  - Redaction covers the plugin's sensitive `userConfig` values, applied in `factory record`.
- **Status.** Contradicted.
- **Evidence.**
  - plugins-reference: *"The variables aren't present in the environment of commands Claude runs through the Bash tool, in the main session or in a subagent."* `CLAUDE_PLUGIN_OPTION_<KEY>` is "exported to hook processes" only.
  - Probe, `bin/factory-env` environment: it had `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID` and `CLAUDECODE`, and **no** `CLAUDE_PLUGIN_*` or `CLAUDE_PROJECT_DIR`.
  - The hook environment in the same run had `CLAUDE_PLUGIN_DATA=/Users/d2t/.claude/plugins/data/d2t-factory-inline`.
  - The data directory id depends on where the plugin was loaded from: `d2t-factory-inline` under `--plugin-dir`, and `d2t-factory-<marketplace>` when installed. The CLI can't hard-code it.
  - Sensitive values are substituted as placeholders in skill content and appear only in the hook environment. The CLI never sees them.
- **Suggested spine fix.** Add a rule to AD-19 or the Paths convention:
  - The CLI learns the plugin root by `realpath` of its own `bin/factory`.
  - It learns the data directory and options from a `SessionStart` hook, which receives `CLAUDE_PLUGIN_DATA` and `CLAUDE_PLUGIN_OPTION_*`. That hook writes `~/.factory/plugin-env.json`.
  - Alternatively, the conductor SKILL.md passes `${CLAUDE_PLUGIN_DATA}` and `${user_config.dashboard_port}`, which are substituted in skill content, as CLI flags.
  - AD-14: if a sensitive option is ever added, only a hook can read it. Route it through the same `plugin-env` mechanism, or note that none exists today.

### V-04: Bash facts don't carry an exit code (AD-14, AD-7 "tool_succeeded / tool_failed")

- **Claim.** A fact stores the command line and its **exit code**.
- **Status.** Contradicted. The exit code can be derived, but no hook delivers it as a field.
- **Evidence.**
  - Probe: the PostToolUse Bash `tool_response` was `{"stdout","stderr","interrupted","isImage","noOutputExpected"}`. It has no exit code.
  - `exit 3` fired **PostToolUseFailure** with `"error":"Exit code 3"` (a string) and `is_interrupt`.
  - hooks.md: PostToolUseFailure gets "error information as top-level fields".
- **Suggested spine fix.** AD-14:
  - `tool_succeeded` implies exit 0.
  - `tool_failed.exit_code` is parsed from `/^Exit code (\d+)/` in `error`, or null otherwise, for example on an interrupt or timeout.
  - List `PostToolUseFailure` explicitly among the async fact hooks.
  - AD-8 is unaffected, because the CLI records its own exit codes.

### V-05: Plugin package.json/lockfile auto-install, and the "local marketplace" install mode (AD-19, Operational envelope)

- **Claim.** Dashboard npm packages are build-time only. A prebuilt `dashboard/dist/` ships. If it's missing, the CLI runs `npm ci` into `${CLAUDE_PLUGIN_DATA}`. The plugin is installed user-level from a local marketplace.
- **Status.** Contradicted. The behavior is unstated and differs from what the spine assumes.
- **Evidence.**
  - plugins/loading "Node.js package dependencies":
    - When Claude Code **copies** a plugin into the cache, it auto-installs the dependencies whenever the plugin root has `package.json` plus a lockfile.
    - The install runs with `--ignore-scripts` and a 60 s timeout, and requires registry deps pinned in the lockfile.
    - *"You can't turn the automatic install off."*
  - A relative-path plugin in a marketplace added from a local path **loads in place**. It gets no install and no cache copy, and `CLAUDE_PLUGIN_ROOT` points at the source directory.
  - In the spine's own install mode, then, `dashboard/dist` must be committed or built in the source tree, and `CLAUDE_PLUGIN_ROOT` is the developer's checkout.
- **Suggested spine fix.**
  - Keep the dashboard's `package.json` and lockfile under `src/dashboard/web/`, not at the plugin root, so no surprise auto-install happens on copied installs.
  - State that `dashboard/dist/` is committed.
  - State that the CLI's fallback build writes only to the data directory, resolved per V-03.

---

## Confirmed with a gap

### V-06: Stop hook and `stop_hook_active` (AD-12)

- **Claim.** A synchronous Stop hook blocks only in working states and honors `stop_hook_active`, so it can't loop.
- **Status.** Confirmed, with gaps.
- **Evidence.**
  - hooks.md, `#### Stop input`: `stop_hook_active` is *"`true` when Claude Code is already continuing as a result of a stop hook."*
  - There is also an *"8-consecutive-continuation cap … resets each time Claude calls a tool"*, configurable with `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`.
  - Stop input also carries `background_tasks` (type `subagent`, with `agent_type`) and `session_crons`. These exist to *"distinguish 'session is done' from 'session is paused waiting for background work'."*
  - `StopFailure` runs **instead of** Stop on API errors, and its output is ignored.
  - Probe payload: `"stop_hook_active":false,"background_tasks":[]`.
- **Suggested spine fix.**
  - AD-12: allow the stop when `background_tasks` contains a `d2t-factory:*` subagent, which is the parallel-reviewer / `wait` step. Without this, the hook forces busy-polling.
  - Decide explicitly what happens when `stop_hook_active` is true. Either allow the stop, which gives one nudge only, or block again and rely on the 8-cap. The cap resets on every tool call, so a conductor that keeps calling `factory next` is never capped.
  - Note that an API error (StopFailure) ends the turn unblockably, and liveness and SIGNAL LOST cover it.

### V-07: `claude agents --json` (AD-21 SIGNAL LOST)

- **Claim.** The dashboard polls `claude agents --json` every 30 s, and SIGNAL LOST requires "no live agent for the run".
- **Status.** Confirmed, with a gap.
- **Evidence.**
  - `claude agents --help`: *"--json  Print active sessions (interactive and background) as a JSON array and exit (for scripting; does not require a TTY)"*. `--all` includes completed background sessions.
  - Observed entries: `{pid,cwd,kind:"interactive",startedAt,sessionId,name,status:"idle"|"busy"}`. The call took 0.11 s.
  - It lists **sessions, not subagents**. The output schema isn't in the docs.
- **Suggested spine fix.**
  - Reword the rule to "no live *session* bound to the run". Join on `sessionId` against `~/.factory/sessions/`.
  - Treat `status:"idle"` while parked as live.
  - Parse leniently, because the schema is undocumented.

### V-08: SubagentStart/SubagentStop agent types and resume (AD-7, memlog "resumed builder via SendMessage")

- **Claim.** `subagent_started` and `subagent_stopped` facts carry `agent_type` `d2t-factory:<role>`. The builder is resumed with SendMessage.
- **Status.** Confirmed, with a gap.
- **Evidence.**
  - hooks.md, `### SubagentStart`: for plugin agents, *"the agent type is the plugin-scoped identifier such as `my-plugin:reviewer`"*. Anchor matchers with `^…$`.
  - SubagentStart *"Runs when Claude spawns a subagent … when Claude resumes a subagent"*.
  - tools-reference: SendMessage resumes *"a subagent … by agent ID or name"*.
- **Suggested spine fix.** In AD-7, a resume fires SubagentStart again with the same `agent_id`. The verification table must key on `(agent_id, step_id)` and not count a resume as a new spawn.

### V-09: Node type stripping has limits beyond `erasableSyntaxOnly` (Conventions "Files and modules", AD-19)

- **Claim.** Erasable TypeScript syntax only (`erasableSyntaxOnly`: no `enum` or `namespace`). The runtime is type stripping with no build.
- **Status.** Confirmed, with a gap.
- **Evidence.**
  - nodejs.org/api/typescript (v26.12.1): type stripping is Stability 2, stable since v25.2.0.
  - Local probes on 26.11.1:
    - `import './b'` fails with `ERR_MODULE_NOT_FOUND`, so explicit `.ts` extensions are mandatory.
    - A value-import of an interface fails with "does not provide an export named 'T'", so `import type` is mandatory.
    - An `enum` is rejected.
    - A constructor parameter property (`private a`) is rejected.
    - A `.ts` file under `node_modules/` throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
  - The docs add that `tsconfig.json` isn't read, `paths` aliases are unsupported (use `#` subpath imports), and decorators are unsupported.
  - TypeScript 7.0.2 `tsc --help --all` lists `--erasableSyntaxOnly`, `--verbatimModuleSyntax`, `--rewriteRelativeImportExtensions` and `--allowImportingTsExtensions`.
- **Suggested spine fix.**
  - Expand the convention: `.ts` extensions in every relative import, and `import type` for types.
  - tsconfig: `module: nodenext`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions` (or `rewriteRelativeImportExtensions`), `noEmit`.
  - No parameter properties or decorators, and no `paths` aliases.
  - `bin/factory` must be a bash or `.js` shim. An extensionless file is not stripped.
  - The plugin must never live under a `node_modules` path. npm-source marketplace installs need checking.

### V-10: `node:sqlite` stability and the Node floor (Stack, memlog)

- **Claim.** Node ≥ 26.5.1, chosen for the CVE-2026-58041 fix. `node:sqlite` is used unflagged.
- **Status.** Confirmed, with a gap.
- **Evidence.**
  - nodejs.org/api/sqlite (v26.12.1): *"Stability: 1.2 - Release candidate"*, a release candidate since v25.7.0 and not Stable. No warning is printed on 26.11.1, per the probe.
  - The July 29 2026 advisory lists CVE-2026-58041 (`createTagStore` stale iterator) as fixed in v26.5.1, v24.18.1 and v22.23.2.
  - The **October 21 2026** advisory fixed 10 more CVEs (tls, dns, http Agent keep-alive, zlib/Brotli, and others) in **v26.12.1**. The local Node, 26.11.1, is unpatched.
  - nodejs.org previous-releases: Node 26 is still "Current" on that page, and 24.22.1 is the latest LTS. Starting with Node 27 the release schedule changes to annual.
- **Suggested spine fix.**
  - Raise the floor to 26.12.1, or state "latest 26.x patch".
  - Note in AD-1 that `node:sqlite` is RC, which is acceptable because the cache can be rebuilt, and pin the API surface used.
  - Avoid `createTagStore` or note it.
  - Update the local Node.

### V-11: Hooks run whatever `node` is on PATH (Structural seed: `hooks.json → node src/hooks/main.ts <event>`)

- **Claim.** Hooks run with `node` from PATH, which is assumed to be ≥ 26.5.1.
- **Status.** Confirmed, with a gap. The mechanism works, but nothing enforces the version.
- **Evidence.** Hook commands run through the user's shell PATH (hooks.md, exec and shell form). Under nvm or volta, `node` can be older than 26, which would mean no unflagged type stripping or sqlite. A failed hook is swallowed by design (AD-13).
- **Suggested spine fix.** The shim checks `process.versions.node` once and writes a single clear `hook-errors.log` entry. `factory start` refuses to run on an old Node with a named error code. Prefer exec-form hooks (`command` plus `args`) so the plugin-root path needs no quoting.

### V-12: Async fact hooks (AD-13)

- **Claim.** Fact hooks are `async: true`, set per handler in plugin `hooks.json`.
- **Status.** Confirmed, with a gap.
- **Evidence.**
  - hooks.md, "Run hooks in the background": *"Add `"async": true` to a command hook's configuration … only available on `type: "command"` hooks."* Async hooks can't block, and timeout isn't enforced on them.
  - *"In non-interactive mode with the `-p` flag, Claude Code kills any async hook still running at teardown."*
  - Probe: an async PostToolUse in plugin `hooks.json` fired and logged.
- **Suggested spine fix.**
  - Note that facts can be lost at `-p` teardown, so dry runs or recordings made with `claude -p` may be missing trailing facts. Keep fact hooks fast: a single append, no git.
  - Write each fact line with one `O_APPEND` write, which is already in AD-4.

### V-13: The UserPromptExpansion trust boundary (AD-6)

- **Claim.** Human decisions enter only as typed `/factory` commands, so the LLM can't forge them.
- **Status.** Confirmed, with a gap.
- **Evidence.** hooks.md, `### UserPromptExpansion`: *"Runs when a user-typed command expands … a `PreToolUse` hook matching the `Skill` tool fires only when Claude calls the tool, but typing `/skillname` directly bypasses `PreToolUse`."* A model-initiated `Skill(d2t-factory:factory, "approve gate1")` therefore produces no expansion fact. This supports the design.
- **Suggested spine fix.**
  - State that the reducer must reject a decision backed only by a Skill-tool invocation.
  - Consider `disable-model-invocation: true` on `skills/factory`. Stage playbooks stay model-invocable.
  - Note that a UserPromptExpansion exit code 2 blocks the expansion. The hook must never exit 2.

---

## Confirmed

| ID | Claim (spine location) | Evidence |
| --- | --- | --- |
| V-14 | `EnterWorktree` triggers `WorktreeCreate` with a `name` (AD-15) | hooks.md: `#### WorktreeCreate input` *"receive the `name` field"*, with `EnterWorktree` named as a trigger. Probe payload `{"name":"factory-abc12"}`. The hook's last stdout line is the path, and a path outside the repo was accepted. **Constraints relevant to V-01's fix** (tools-reference, EnterWorktree): *"Pass a `path` to switch into an existing worktree … A `path` outside `.claude/worktrees/` prompts for your approval … From within a worktree session … only the `path` form is available and the target must be under `.claude/worktrees/`"*. So there is one run per conductor session, and a resume in a new session gets an approval prompt. |
| V-15 | WorktreeRemove input (AD-13) | hooks.md: `worktree_path` field. It isn't run for subagent or workflow worktrees, and a non-zero exit fails the removal if the directory still exists. This becomes moot if V-01's fix is taken. |
| V-16 | Worktree isolation versus CLI git operations (AD-8, CAP-13) | worktrees.md, "How Claude Code enforces isolation": once in a worktree, Claude Code blocks Bash whose cwd is the main checkout, and git redirects into it (`git -C`, `GIT_DIR`, `cd`). The checks read command text only, so `factory …` running git internally isn't blocked. **Rule to add:** SCAFFOLD's main-checkout `git status` and the local merge are done *inside the CLI*, never as conductor Bash git commands. |
| V-17 | The plugin `bin/` is on the Bash PATH and `CLAUDE_CODE_SESSION_ID` is in the Bash env (AD-9) | This repeats the author's check under `-p`: `CLAUDE_CODE_SESSION_ID=6d781fdc-…` matched the hook `session_id`. It's still undocumented, so keep the PostToolUse fallback. |
| V-18 | Plugin agent naming `d2t-factory:<role>` and the `model` frontmatter (Conventions) | plugins/components, "Frontmatter fields in plugin agents": `model` is supported. `permissionMode`, `hooks` and `mcpServers` are **ignored**, which the spine doesn't rely on. Subfolders add name segments, so keep agents flat. |
| V-19 | Hook environment (`CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_OPTION_*`) | Probe hook env plus plugins/components. `CLAUDE_PROJECT_DIR` stays at the launch repo after EnterWorktree, while `cwd` follows the worktree (worktrees.md note). The hook must use `cwd` to find the worktree. |
| V-20 | Hook timeouts are adequate for the synchronous hooks | hooks.md "Common fields": the default is 600 s for command hooks, lowered to 30 s on UserPromptSubmit. |
| V-21 | Svelte 5 `crossfade` and `animate:flip` (frontend decision) | `npm pack svelte@5.57.2` (latest): `src/transition/index.js:244 export function crossfade`, `src/animate/index.js:13 export function flip`, and `./animate` and `./transition` exports. `flip` needs keyed `{#each}`. |
| V-22 | Vite 8.3.5 and vite-plugin-svelte 7.3.1 are compatible with Svelte 5.57.2 and Node 26 | `npm view`: vite engines `^20.19.0 \|\| >=22.12.0`; plugin peer `vite ^8.0.0`, `svelte ^5.46.4`, engines `>=24`. |
| V-23 | Recursive `fs.watch` on macOS (AD-16) | Probe on Node 26.11.1 with `fs.watch(root,{recursive:true})` saw newly created nested directories and files (`rename:b/runs/r2/facts`, `rename:b/runs/r2/facts/new.jsonl`). Events arrive as `rename`/`change` with coalescing, so the tailer must track byte offsets per file and not rely on event type. Keep the 2 s poll. |
| V-24 | agent-browser `--session <name>` (AD-22) | `npx agent-browser@0.39.2 --help`: `--session <name>  Isolated session (or AGENT_BROWSER_SESSION env)`. **Add:** it needs `agent-browser install` (browser binaries) once. Make that a SCAFFOLD or preflight check. |
| V-25 | TypeScript 7.0.2 is `latest` and supports the needed flags | `npm view typescript dist-tags` gives `latest: 7.0.2`. `tsc --help --all` lists `erasableSyntaxOnly`, `verbatimModuleSyntax`, `rewriteRelativeImportExtensions` and `allowImportingTsExtensions`. |

---

## Unverifiable

| ID | Claim | Why | Suggested action |
| --- | --- | --- | --- |
| V-26 | The exact Node 26 LTS promotion date (Stack "≥ 26.5.1") | nodejs.org/previous-releases still shows 26 as "Current" and gives no LTS date | Doesn't affect the design. Re-check at implementation. |
| V-27 | That port 4870 and the 5100–5199 range are free on typical dev machines (AD-16, AD-20) | Not checked against common tool defaults | Low risk. The singleton logic must handle `EADDRINUSE` from a foreign process: distinguish it via the pid file and report it, rather than assuming our own dashboard is running. |
| V-28 | Sandbox write access to `~/.factory` for the CLI run via Bash (Deferred) | Depends on the user's sandbox settings. Hooks run unsandboxed (hooks.md, DirectoryAdded note), but Bash commands may be sandboxed | The spine already defers this to the spike. Add `~/.factory` to the sandbox `allowWrite` in the plugin README, or check it in a preflight. |

---

## Sources

- https://code.claude.com/docs/en/hooks (raw: https://code.claude.com/docs/en/hooks.md). Sections: WorktreeCreate, WorktreeRemove, Stop input, SubagentStart, UserPromptExpansion, PostToolUseFailure, Run hooks in the background, Common input fields
- https://code.claude.com/docs/en/plugins-reference (Environment variables, userConfig, Standard layout)
- https://code.claude.com/docs/en/plugins/components (skills naming, agents frontmatter, hooks env, executables)
- https://code.claude.com/docs/en/plugins/loading (in-place vs copied, Node.js package dependencies, data dir)
- https://code.claude.com/docs/en/skills (how a skill gets its command name)
- https://code.claude.com/docs/en/worktrees (defaults, cleanup, isolation enforcement, sweep marker)
- https://code.claude.com/docs/en/tools-reference (EnterWorktree, ExitWorktree, SendMessage)
- https://nodejs.org/api/sqlite.html, https://nodejs.org/api/typescript.html (v26.12.1 docs)
- https://nodejs.org/en/blog/vulnerability/july-2026-security-releases, https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- https://nodejs.org/en/about/previous-releases
- Local: `claude --help`, `claude agents --help`, `claude agents --json`, the probe plugin run under `claude -p --plugin-dir` (payloads saved in the session scratchpad `log/`), Node probes, `npm view` / `npm pack`, `npx agent-browser@0.39.2 --help`, `npx typescript@7.0.2 tsc --help --all`
