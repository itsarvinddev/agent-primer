# CodeGraph — Session-Startup Rule (every agent; set up once per project, then trust it)

**This is a hard rule for every AI coding agent — Claude Code, Codex, Cursor, Gemini CLI,
opencode, Antigravity, Kimi Code, Qoder, and any other.** The **first time** you work in a project,
before doing substantive work, ensure CodeGraph is installed and this project is indexed. CodeGraph
is a tree-sitter knowledge graph of every symbol, edge, and file; its `codegraph_*` MCP tools answer
structural questions (definitions, callers/callees, impact, traces) that grep cannot, in
sub-millisecond reads. Once a project is indexed, CodeGraph's file-watcher keeps the index fresh
automatically — so this is **one-time setup per project, not an every-session ceremony**.

In repos that wire the bundled `SessionStart` hook, Agent-Primer runs this check for you at session
start (`codegraph-session-check.sh` from the curl/bash kit, or `primer codegraph-check` from the npm
package). By default it runs in **once-per-project** mode: it injects a `[CodeGraph]` setup block
**only while the project still needs setup** (no `codegraph` CLI, or no `.codegraph/` index yet);
once the project is indexed it goes **silent**. So:

- **A `[CodeGraph]` setup block IS present →** the project isn't set up yet; follow it (and the
  decision tree below) before starting the task. If setup needs user consent, ask the direct yes/no
  question from the block immediately; do not bury it as "let me know if you want."
- **No `[CodeGraph]` block appears (in a hook-wired repo) →** the project is **already set up — just
  proceed**, and prefer `codegraph_*` tools. Do **not** re-run `codegraph init`/`status` "to be safe":
  the file-watcher keeps the index fresh, and re-checking every session is the noise this mode removes.
- **No startup hook at all (e.g. Qoder), or you're unsure one is wired →** run the one-time decision
  tree below yourself; once `.codegraph/` exists, treat the project as set up and proceed thereafter.

(Operators who want the legacy every-session `codegraph status` readout can install the hook with
`--always`; it prints index status at the start of every session even after setup.)

---

## The one-time setup decision tree (first time you work in a project)

1. **Is the `codegraph` CLI installed?** — `command -v codegraph` (or `codegraph --version`).
   - **No →** ask the user this exact simple question, then install if they say yes:
     "CodeGraph is not installed yet. Want me to install it and index this repo now? I will run:
     `<install command>`, `codegraph install`, and `codegraph init -i`."
2. **Is THIS project indexed?** — does `.codegraph/` exist at the repo root, and does
   `codegraph status` succeed?
   - **No →** ask: "CodeGraph is installed, but this repo is not indexed yet. Want me to run
     `codegraph init -i` now?" If yes, run it.
3. **Index freshness** — after the initial `init -i`, CodeGraph's file-watcher keeps the index in
   sync with the working tree automatically; you do **not** need to run `codegraph status` / `sync`
   at the start of every session. Only if you have a concrete reason to suspect drift (e.g. a large
   external checkout or branch switch the watcher may have missed) run `codegraph status`, then
   `codegraph sync` if it reports pending / changed / stale files, before relying on `codegraph_*`.

Once the index is present, start the user's task and prefer `codegraph_*` tools for structural work.
If the user declines setup, proceed without CodeGraph and briefly note that structural code answers
may be weaker.

---

## Installing from scratch (when the CLI is missing)

You may install and set CodeGraph up when the user says yes. **Ask directly; do not wait for the user
to infer what to do from a passive note.** Then announce each command before running it (it touches
the user's machine), in order:

| Step | Command | Purpose |
|---|---|---|
| 1. Install CLI (macOS/Linux) | `curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh \| sh` | Self-contained binary; no Node required |
| 1. Install CLI (any OS, alt) | `npm i -g @colbymchenry/codegraph` | npm alternative |
| 1. Install CLI (Windows) | `irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 \| iex` | PowerShell |
| 2. Register MCP into agents | `codegraph install` | Adds the `codegraph` MCP server to Claude Code / Cursor / Codex / opencode / Gemini / etc. config |
| 3. Build the index | `codegraph init -i` | Creates `.codegraph/` and indexes the repo |
| 4. Keep it fresh later | `codegraph sync` | Incremental update since last index |

---

## The restart reality — be honest about it

Registering the MCP server (`codegraph install`) makes the `codegraph_*` **MCP tools** available
**only after the agent/IDE restarts** — and **you cannot restart yourself or your host app**. So:

- Do **everything that does not need a restart** right now: install the CLI, `codegraph install`,
  `codegraph init -i`, `codegraph sync`.
- **Use the `codegraph` CLI via your shell/Bash immediately** for the current task — it works
  without the MCP tools (`codegraph query`, `codegraph context <task>`, `codegraph callers`,
  `codegraph callees`, `codegraph impact`, `codegraph files`, `codegraph status`).
- Then **explicitly ask the user to restart** the agent/IDE (Claude Code: restart or `/mcp`
  reconnect; Cursor: Reload Window; Codex/Gemini/opencode/Kimi: restart the CLI; Antigravity/Qoder:
  restart the IDE) so the `codegraph_*` MCP tools load, and resume the task afterward.
- **Never claim you restarted yourself.** Never fabricate that the MCP tools are available when
  they are not — verify, or use the CLI.

---

## Don'ts

- **Don't be passive when setup is missing.** Do not say "I won't set it up unless you want me to" or
  "flag it if you'd like." Ask the direct yes/no setup question immediately, then act on the answer.
- **Don't re-run the setup check once the project is already indexed.** A missing `[CodeGraph]` hook
  block in a wired repo means "set up — proceed," not "re-check"; re-running `init`/`status` every
  session is exactly the noise once-mode removes. Trust the file-watcher (or install with `--always`).
- **Don't silently `curl | sh`** without announcing it — installing software touches the user's
  machine; say what you're running first.
- **Don't run `codegraph uninit` / `uninstall`** unless the user explicitly asks.
- **Don't re-query `codegraph_*` immediately after editing a file** in the same turn — the watcher
  debounces ~500 ms behind writes; `codegraph sync` or wait a beat first.
- **Don't trust grep over a fresh index** for structural questions — prefer `codegraph_*`.

---

## Precedence

Where this project's auto-generated CodeGraph block (between `<!-- CODEGRAPH_START -->` and
`<!-- CODEGRAPH_END -->` in `CLAUDE.md` / `AGENTS.md` / `.cursor/rules/codegraph.mdc`) says to
*ask the user before running `codegraph init -i`*, **this rule supersedes it**: at session start you
may initialize/sync automatically (announcing commands). That managed block is regenerated by
`codegraph install`, so this rule lives in a separate, unmanaged file on purpose.
