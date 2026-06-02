# codegraph-bootstrap

Make **every AI coding agent** check [CodeGraph](https://github.com/colbymchenry/codegraph) at the
start of each session — install it if missing, build the index if absent, `codegraph sync` if stale
— **before** doing substantive work. Drop it into any project, or install once globally for all
projects.

Covers: **Claude Code, Codex, Cursor, Gemini CLI, opencode, Antigravity, Kimi Code, Qoder** (and any
other agent that reads `AGENTS.md`).

## What's in here

| File | Role |
|---|---|
| `codegraph-session-check.sh` | The hook. Read-only, always `exit 0`. Detects CLI/index/freshness and emits a directive. `--format text\|json\|cursor`. |
| `codegraph-policy.md` | The rule. The canonical session-startup policy, copied into each agent's instruction file. |
| `install.sh` | Wires the script + policy + hooks into agents. `--global` or `--project`. Idempotent. |
| `codegraph-bootstrap.sh` | **Single self-contained file** (the other three inlined). Carry/curl this to a new machine. |
| `make-portable.sh` | Regenerates `codegraph-bootstrap.sh` after you edit the kit. |
| `docs/design.md` | Design notes + the cross-agent research this is built on. |

## How it works

Two pieces are wired into each agent's config:

1. **The rule** (`codegraph-policy.md`) — a markdown doc each agent auto-loads into context every
   session (via `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` / a Kimi skill / …). It states the
   MUST-do behavior + exact commands.
2. **The hook** — a `SessionStart` entry that auto-runs `codegraph-session-check.sh` the instant a
   session starts:

```
session starts → hook runs codegraph-session-check.sh →
  • no codegraph CLI    → "install it → codegraph install → restart"
  • no .codegraph/ dir  → "run codegraph init -i"
  • index is stale      → "run codegraph sync"
  • all good            → "proceed; prefer codegraph_* tools"
→ injected into the agent's context → the agent acts on it before your task
```

The script is read-only and always exits 0 — it never blocks a session. The agent does any install
itself (announcing commands), uses the `codegraph` CLI immediately, and asks you to restart only so
the `codegraph_*` MCP tools load.

## Install

**This machine — every project at once (recommended):**
```bash
./install.sh --global
```

**One project (committed, shared with a team):**
```bash
./install.sh --project /path/to/repo
```

**Preview / subset:**
```bash
./install.sh --global --dry-run
./install.sh --project --agents claude,cursor,codex
```

Then restart your agent/IDE so hooks + MCP tools load. (The `codegraph` CLI works in your shell
immediately.) Install the CLI itself with:
```bash
curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh && codegraph install
```

## Brand-new machine

This is a **private** repo, so `raw.githubusercontent.com` needs auth — use `gh` (after
`gh auth login`):

```bash
# clone + install (simplest):
gh repo clone itsarvinddev/codegraph-bootstrap ~/.codegraph-bootstrap-src \
  && ~/.codegraph-bootstrap-src/install.sh --global

# or one-liner via the single self-contained file (gh streams it, private-safe):
gh api -H "Accept: application/vnd.github.raw" \
  repos/itsarvinddev/codegraph-bootstrap/contents/codegraph-bootstrap.sh | bash -s -- --global
```

If you later make the repo public, the classic curl one-liner also works:
```bash
curl -fsSL https://raw.githubusercontent.com/itsarvinddev/codegraph-bootstrap/main/codegraph-bootstrap.sh | bash -s -- --global
```

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
- After editing any kit file, run `./make-portable.sh` to refresh `codegraph-bootstrap.sh`.
