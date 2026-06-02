# agent-primer

**Prime every AI coding agent at session start.** One install equips your coding agents — **Claude
Code, Codex, Cursor, Gemini CLI, opencode, Antigravity, Kimi Code, Qoder** (and any agent that reads
`AGENTS.md`) — with a curated, growing set of enhancements *before* they do substantive work. Drop it
into any project, or install once globally for all projects.

It installs **three policies** into the same instruction files, so every agent gets all of them:

- **CodeGraph session-startup rule** (`codegraph-policy.md`) — install / index / sync before work; backed by a `SessionStart` hook.
- **Karpathy coding guidelines** (`karpathy-policy.md`) — think before coding, simplicity first, surgical changes, goal-driven execution; from [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills). Policy-only (no hook).
- **Superpowers** (`superpowers-policy.md`) — bootstraps the [obra/superpowers](https://github.com/obra/superpowers) skills plugin per agent + carries its TDD / systematic / simplicity / evidence methodology. Policy-only (no hook).

## What's in here

| File | Role |
|---|---|
| `codegraph-session-check.sh` | The hook. Read-only, always `exit 0`. Detects CLI/index/freshness and emits a directive. `--format text\|json\|cursor`. |
| `codegraph-policy.md` | Policy #1 — the CodeGraph session-startup rule, copied into each agent's instruction file. |
| `karpathy-policy.md` | Policy #2 — the Karpathy coding guidelines (behavioral; no hook), copied alongside policy #1. |
| `superpowers-policy.md` | Policy #3 — bootstraps the obra/superpowers plugin + carries its methodology (behavioral; no hook). |
| `install.sh` | Wires the hook script + all three policies into agents. `--global`/`--project`, `--agents`, `--dry-run`, `--version`. Idempotent; refuses to touch unparseable configs; writes atomically. |
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

## Brand-new machine

This is a **private** repo, so `raw.githubusercontent.com` needs auth — use `gh` (after
`gh auth login`):

```bash
# clone + install (simplest):
gh repo clone itsarvinddev/agent-primer ~/.agent-primer-src \
  && ~/.agent-primer-src/install.sh --global

# or one-liner via the single self-contained file (gh streams it, private-safe):
gh api -H "Accept: application/vnd.github.raw" \
  repos/itsarvinddev/agent-primer/contents/agent-primer.sh | bash -s -- --global
```

If you later make the repo public, the classic curl one-liner also works:
```bash
curl -fsSL https://raw.githubusercontent.com/itsarvinddev/agent-primer/main/agent-primer.sh | bash -s -- --global
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
- After editing any kit file, run `./make-portable.sh` to refresh `agent-primer.sh`.
- Verify with `tests/smoke.sh` (install/uninstall, idempotency, dry-run, malformed-config safety, no-python3 fallback). CI runs `shellcheck` + `bash -n` + the smoke suite + a bundle-drift gate on every push.

## Upstream projects

agent-primer **wires these projects into your agents — it doesn't replace them.** Go read/star the originals:

- **[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph)** — the CodeGraph CLI + MCP server: the tree-sitter code-intelligence index this kit's session-startup rule checks for.
- **[multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)** — the Karpathy coding guidelines this kit distills (a republish of [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills), derived from [Andrej Karpathy's notes](https://x.com/karpathy/status/2015883857489522876)).
- **[obra/superpowers](https://github.com/obra/superpowers)** — the Superpowers skills plugin / methodology this kit bootstraps per agent.

## License

MIT — see [LICENSE](LICENSE).
