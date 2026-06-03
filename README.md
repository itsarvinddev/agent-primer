# agent-primer

**Prime every AI coding agent at session start.** One install equips your coding agents — **Claude
Code, Codex, Cursor, Gemini CLI, opencode, Antigravity, Kimi Code, Qoder** (and any agent that reads
`AGENTS.md`) — with a curated, growing set of enhancements *before* they do substantive work. Drop it
into any project, or install once globally for all projects.

It installs **three policies** into the same instruction files, so every agent gets all of them:

- **CodeGraph session-startup rule** (`codegraph-policy.md`) — install / index / sync [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) before work; backed by a `SessionStart` hook.
- **Karpathy coding guidelines** (`karpathy-policy.md`) — think before coding, simplicity first, surgical changes, goal-driven execution; from [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills). Policy-only (no hook).
- **Superpowers** (`superpowers-policy.md`) — bootstraps the [obra/superpowers](https://github.com/obra/superpowers) skills plugin per agent + carries its TDD / systematic / simplicity / evidence methodology. Policy-only (no hook).

Those **three core policies install by default.** Five more **opt-in bundles** ride the same channels
via `--with` (e.g. `install.sh --global --with mcp,rules`, or `--with all`) — kept out of the default
so agents don't carry context they didn't ask for:

| `--with` bundle | Adds |
|---|---|
| `mcp` | Recommended MCP servers — [Context7](https://github.com/upstash/context7) (docs) · [GitHub](https://github.com/github/github-mcp-server) · [Playwright](https://github.com/microsoft/playwright-mcp) |
| `tools` | CLI companions — [ast-grep](https://github.com/ast-grep/ast-grep) (structural rewrite) + [repomix](https://github.com/yamadashy/repomix) (context packing) |
| `rules` | Security (OWASP-distilled) + [12-Factor Agents](https://github.com/humanlayer/12-factor-agents) + commit/PR hygiene |
| `skills` | More skill registries — [Anthropic skills](https://github.com/anthropics/skills) · [skills.sh](https://skills.sh) · [VoltAgent](https://github.com/VoltAgent/awesome-agent-skills) |
| `agent-extensions` | Each agent's own first-party plugins/skills (Claude marketplaces, `gemini extensions`, Codex `/plugins`, …) |

## ⭐ primer — a coding-style engine for your agents

[`primer`](primer/) is the kit's flagship: a **local-first personal coding-intelligence engine.**
*What CodeGraph is for code structure, primer is for your coding taste.* It learns your style from
your own edits and serves it back to every agent over **MCP**, so they write code the way **you** do
— **100% local: no model, no network, no telemetry.** Published as
[`@agent-primer/primer`](https://www.npmjs.com/package/@agent-primer/primer) (Node ≥ 22.5).

It runs a continuous loop, entirely on your machine:

1. **Apply** — a `[Primer]` style brief is injected at every session start; agents also pull scoped
   preferences on demand via `primer_apply`.
2. **Capture** — a PostToolUse hook pipes each edit to `primer signal`, privacy-gated: secrets,
   generated, and dependency files are never captured.
3. **Distill** — when signals accrue, the agent calls `primer_learn`; `web-tree-sitter` parses the
   before/after across **~22 languages** into *ranked candidate preferences*, and the agent records
   the durable ones with `primer_record`. (Distillation spends **your** agent's tokens — primer
   ships no model of its own.)
4. **Impact** — `primer_impact` reports a file's style facts and which recorded preferences govern
   it, or a preference's `conflicts` / `supersedes` / `co-occurs` edges.

Six MCP tools — `primer_apply` · `primer_record` · `primer_query` · `primer_learn` ·
`primer_impact` · `primer_status` — plus a full CLI, over a local SQLite style-graph (WAL + FTS5) in
a gitignored `.primer/`. The unified installer wires the `[Primer]` brief into Claude / Cursor /
Gemini / Codex / Antigravity / opencode (Kimi on `--global`; Qoder gets the policy) and edit-capture
into Claude + Kimi. Details in [primer/DESIGN.md](primer/DESIGN.md) and [primer/README.md](primer/README.md).

```bash
npx @agent-primer/primer setup --global    # one command: the 3 core policies AND primer
# …or with the bash/curl kit:  install.sh --global --with primer   (opt-in; needs Node ≥ 22.5)
```

## What's in here

| File | Role |
|---|---|
| `codegraph-session-check.sh` | The hook. Read-only, always `exit 0`. **Once per project by default** — nudges until set up, then silent. `--format text\|json\|cursor`; `--always` keeps the every-session `codegraph status` readout. |
| `codegraph-policy.md` | Policy #1 — the CodeGraph session-startup rule, copied into each agent's instruction file. |
| `karpathy-policy.md` | Policy #2 — the Karpathy coding guidelines (behavioral; no hook), copied alongside policy #1. |
| `superpowers-policy.md` | Policy #3 — bootstraps the obra/superpowers plugin + carries its methodology (behavioral; no hook). |
| `{mcp,tools,rules,skills,agent-extensions}-policy.md` | Five **opt-in** bundle docs — installed only via `--with` (see the bundle table above). |
| `primer-policy.md` + `primer/` | **`primer`** — a local coding-style engine (its own DB + MCP server), published as `@agent-primer/primer`. `npx @agent-primer/primer setup` installs it + the 3 policies; via bash it's `--with primer` (needs Node, not in `--with all`). See [its DESIGN](primer/DESIGN.md). |
| `install.sh` | Wires the hook script + policies into agents. `--global`/`--project`, `--agents`, `--with`, `--dry-run`, `--always`, `--version`. Idempotent; refuses to touch unparseable configs; writes atomically. |
| `uninstall.sh` | Cleanly reverses an install (same flags). Idempotent and safe to run when nothing is installed. |
| `agent-primer.sh` | **Single self-contained file** — the hook script, the three policies, and install + uninstall inlined. Carry/curl to a new machine (`bash agent-primer.sh --uninstall` removes). |
| `make-portable.sh` | Regenerates `agent-primer.sh` after you edit the kit. |
| `tests/smoke.sh` | Install/uninstall verification (run by CI). |

## How it works

These pieces are wired into each agent's config:

1. **The policies** — three markdown docs each agent auto-loads into context every session (via
   `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` / a Kimi skill / …): `codegraph-policy.md` (the
   CodeGraph session-startup rule — MUST-do behavior + exact commands), `karpathy-policy.md`
   (the Karpathy coding guidelines), and `superpowers-policy.md` (the Superpowers methodology +
   per-agent plugin-install bootstrap).
2. **The hook** (CodeGraph rule only) — a `SessionStart` entry that auto-runs `codegraph-session-check.sh`
   the instant a session starts:

```
session starts → hook runs codegraph-session-check.sh →
  • no codegraph CLI    → "install it → codegraph install → restart"
  • no .codegraph/ dir  → "run codegraph init -i"
  • project is set up   → (default) SILENT — already initialized, just proceed
                          (install with --always to print `codegraph status` every session)
→ injected into the agent's context → the agent acts on it before your task
```

The script is read-only and always exits 0 — it never blocks a session. **By default it's quiet once
the project is set up** — it nudges only until `.codegraph/` exists, after which CodeGraph's
file-watcher keeps the index fresh; pass `--always` at install time to keep the every-session status
readout. The agent does any install itself (announcing commands), uses the `codegraph` CLI
immediately, and asks you to restart only so the `codegraph_*` MCP tools load.

## Install

### Quickest — `npx` (one command: the 3 core policies **+** primer)

```bash
npx @agent-primer/primer setup --global           # all projects
npx @agent-primer/primer setup --project .         # one repo
# reverse:  npx @agent-primer/primer teardown --global
```

Needs Node ≥ 22.5 (for primer) plus `bash` + `python3` (the kit is bash-based). Flags like
`--agents claude,cursor`, `--with mcp,rules`, `--dry-run` pass straight through to the installer.

### Or the curl bundle (no Node needed for the core policies)

Whether a person runs it or an AI agent does it for you, the bash kit installs the same way: get the
repo (one `curl`, or a clone), then run `install.sh`. Pick your path.

### For humans

#### Option A — let your AI agent do it

Already using an AI coding agent (Claude Code, Cursor, Codex, …)? Paste this and let it install
agent-primer for you (it just follows the **For LLM agents** steps below):

> Install **agent-primer** on my machine from https://github.com/itsarvinddev/agent-primer — run
> `curl -fsSL https://raw.githubusercontent.com/itsarvinddev/agent-primer/main/agent-primer.sh | bash -s -- --global`,
> then tell me what it wired and that I should restart you so the hooks + `codegraph_*` MCP tools load.

#### Option B — manual setup

One self-contained file — `curl | bash` it (review it first if you like; it self-extracts to
`~/.agent-primer` and runs the installer):

```bash
# every agent, every project (recommended):
curl -fsSL https://raw.githubusercontent.com/itsarvinddev/agent-primer/main/agent-primer.sh | bash -s -- --global

# or just one repo (committed, shareable with a team):
curl -fsSL https://raw.githubusercontent.com/itsarvinddev/agent-primer/main/agent-primer.sh | bash -s -- --project /path/to/repo
```

Prefer not to pipe into a shell? Clone and run the installer directly:
```bash
gh repo clone itsarvinddev/agent-primer ~/.agent-primer-src && ~/.agent-primer-src/install.sh --global
```

Flags: `--global` / `--project [DIR]` · `--agents claude,cursor,codex` (subset) ·
`--with mcp,rules,…` (opt-in bundles, or `all`) · `--dry-run` · `--always` (legacy every-session
`codegraph status` readout; default is quiet after first-run setup).

Then **restart your agent/IDE** so hooks + MCP tools load (the `codegraph` CLI works in your shell
right away). Install the CodeGraph CLI itself with:
```bash
curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh && codegraph install
```

### For LLM agents

You're an AI coding agent installing agent-primer for the user. **Announce each command before
running it** (it touches their machine), then:

#### Step-by-step

1. **Install agent-primer** — clone and run the installer (`--global` = all the user's projects, or
   `--project <dir>` for one repo):
   ```bash
   gh repo clone itsarvinddev/agent-primer ~/.agent-primer-src && ~/.agent-primer-src/install.sh --global
   ```
   Single-file alternative: `curl -fsSL https://raw.githubusercontent.com/itsarvinddev/agent-primer/main/agent-primer.sh | bash -s -- --global`
2. **Ensure the CodeGraph CLI is present** (`command -v codegraph`); if missing, install it so the
   hook can index projects:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh && codegraph install
   ```
3. **Read and follow the policies** now wired into your instruction file(s) (`CLAUDE.md` /
   `AGENTS.md` / `.cursor/rules` / Kimi skill): the CodeGraph session-startup rule, the Karpathy
   coding guidelines, and the Superpowers bootstrap.
4. **Ask the user to restart** the agent/IDE so the SessionStart hook + `codegraph_*` MCP tools load.
   You cannot restart yourself — never claim you did.

#### Verification

Confirm it took, and report what you find (don't assume):
```bash
ls ~/.agent-primer/                          # global kit dir: codegraph-session-check.sh + the 3 *-policy.md
grep -c ':start -->' ~/.claude/CLAUDE.md     # global Claude: expect 3 policy blocks (adjust path per agent)
bash ~/.agent-primer/codegraph-session-check.sh --project "$PWD"   # silent if this project is indexed; nudges if not
```
- All three policy blocks (`codegraph-session-startup`, `karpathy-guidelines`, `superpowers`) present
  in your instruction file? `~/.agent-primer/` populated?
- After a restart, are the `codegraph_*` MCP tools available?
- Once-mode sanity: a project with no `.codegraph/` shows the `[CodeGraph]` setup nudge at session
  start; once `codegraph init -i` has run, later sessions are silent.

## Uninstall

```bash
./uninstall.sh --global                 # remove from your user-level configs
./uninstall.sh --project /path/to/repo   # remove from one repo
```

Mirrors `install.sh`'s flags (`--agents`, `--dry-run`). It strips the policy blocks, removes the
SessionStart hook entries, deletes the rule/skill files, and removes the kit dir — idempotent, and
it never touches a config it can't parse. Via the self-contained file: `bash agent-primer.sh --uninstall --global`.

It removes **agent-primer's wiring only** — the tools the policies bootstrap (the CodeGraph CLI, the
Superpowers plugin/skills) are left in place, and uninstall prints the exact commands to remove those
yourself if you want them gone (it never runs them — the CodeGraph CLI may be one you use elsewhere).

## How each agent is wired

| Agent | Policy (rule) | Hook |
|---|---|---|
| Claude Code | `.claude/rules/…md` (project) · `~/.claude/CLAUDE.md` (global) | `.claude/settings.json` → `SessionStart` |
| Codex | `AGENTS.md` (native) | `.codex/hooks.json` → `SessionStart` |
| Cursor | `AGENTS.md` + `.cursor/rules/*.mdc` | `.cursor/hooks.json` → `sessionStart` (Cursor ≥ 1.7) |
| Gemini CLI | `GEMINI.md` + `context.fileName=[AGENTS.md,GEMINI.md]` | `.gemini/settings.json` → `SessionStart` |
| opencode | `AGENTS.md` (native) | `.opencode/plugins/*.js` → `session.created` |
| Antigravity | `AGENTS.md` + `.agents/rules/…md` | `.agents/hooks.json` → `SessionStart` |
| Kimi Code | `.kimi-code/skills/…/SKILL.md` | `~/.kimi-code/config.toml` `[[hooks]]` (**`--global` only**) |
| Qoder | `AGENTS.md` + `.qoder/rules/…md` | — (no `SessionStart` event; rule-carried) |

The **policy** guarantees coverage everywhere; the **hook** is the automation layer (confirmed on
Claude Code / Gemini / Cursor, best-effort elsewhere — but the agent still reads the policy).

## Requirements & notes

- `bash`. `python3` is used for safe, idempotent JSON/TOML merges; without it, the installer writes
  files that don't exist and **prints the exact snippet** for any config it can't merge — it never
  clobbers an existing config.
- Agents can't restart themselves — after an install the `codegraph_*` MCP tools appear only after
  you restart the agent/IDE; until then the agent uses the `codegraph` CLI. See `codegraph-policy.md`.
- In `--global` mode the policy doc goes to each agent's real global home (`~/.claude/CLAUDE.md`,
  `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.kimi-code/skills/`).
  Cursor global rules are UI-only (the global hook covers it); Qoder has no global hook — wire it
  per-project.
- After editing any kit file, run `./make-portable.sh` to refresh `agent-primer.sh`.
- Verify with `tests/smoke.sh` (install/uninstall, idempotency, dry-run, malformed-config safety, no-python3 fallback). CI runs `shellcheck` + `bash -n` + the smoke suite + a bundle-drift gate on every push.

## Upstream projects

agent-primer **wires these projects into your agents — it doesn't replace them.** Go read/star the originals:

- **[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph)** — the CodeGraph CLI + MCP server: the tree-sitter code-intelligence index this kit's session-startup rule checks for.
- **[multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)** — the Karpathy coding guidelines this kit distills (a republish of [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills), derived from [Andrej Karpathy's notes](https://x.com/karpathy/status/2015883857489522876)).
- **[obra/superpowers](https://github.com/obra/superpowers)** — the Superpowers skills plugin / methodology this kit bootstraps per agent.

The opt-in `--with` bundles point at: [Context7](https://github.com/upstash/context7),
[GitHub MCP](https://github.com/github/github-mcp-server), [Playwright MCP](https://github.com/microsoft/playwright-mcp),
[ast-grep](https://github.com/ast-grep/ast-grep), [repomix](https://github.com/yamadashy/repomix),
[Anthropic skills](https://github.com/anthropics/skills), [skills.sh](https://skills.sh),
[VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills),
[12-Factor Agents](https://github.com/humanlayer/12-factor-agents), and the
[OWASP GenAI/LLM](https://genai.owasp.org/) security guidance.

## License

MIT — see [LICENSE](LICENSE).
