# agent-primer

Give every AI coding agent the same good start.

Agent-Primer is a small setup kit for people who use AI coding agents such as Claude Code, Codex,
Cursor, Gemini CLI, opencode, Antigravity, Kimi Code, or Qoder. It installs shared instructions and
startup checks so your agents begin each session with better habits: understand the codebase before
editing, keep changes simple, verify their work, and use the right local tools.

It can be installed once for all your projects, or inside one project so a team can share the same
agent setup.

## Why Use It

AI coding agents work best when they start with the right context and rules. Without that, each agent
may behave a little differently, forget useful tooling, or skip setup steps that would have helped it
understand the code.

Agent-Primer gives them a common baseline:

- **CodeGraph bootstrap**: installs/registers CodeGraph when needed and indexes a new repo on the
  first hit, so structural questions use definitions, callers, callees, traces, and impact instead
  of slow file-reading.
- **Careful coding habits**: asks agents to make small, focused changes, avoid guessing, and verify
  before calling work done.
- **Superpowers methodology**: guides agents toward systematic, test-first work and can bootstrap the
  Superpowers skills plugin where supported.
- **Optional Primer style memory**: learns your coding preferences locally and serves them back to
  agents through MCP.

## Quick Start

### Option 1: Full Setup With Primer

Use this if you want the core Agent-Primer setup plus Primer, the local coding-style memory.

```bash
npx @agent-primer/primer setup --global
```

Use `--global` to install for all projects. Use `--project .` to install only in the current repo:

```bash
npx @agent-primer/primer setup --project .
```

Requirement for this path: Node 22.13 or newer. The npm setup path is native Node and does not require
`bash`; it works on Windows, macOS, and Linux.

### Option 2: Core Agent-Primer Only

Use this if you want the core policies and CodeGraph startup check without installing the Primer
Node package. This path is shell-based, so it expects `bash` and preferably `python3`.

```bash
curl -fsSL https://raw.githubusercontent.com/itsarvinddev/agent-primer/main/agent-primer.sh | bash -s -- --global
```

For one repo only:

```bash
curl -fsSL https://raw.githubusercontent.com/itsarvinddev/agent-primer/main/agent-primer.sh | bash -s -- --project /path/to/repo
```

Prefer cloning first?

```bash
gh repo clone itsarvinddev/agent-primer ~/.agent-primer-src
~/.agent-primer-src/install.sh --global
```

After either install path, restart your agent or IDE so the new hooks and MCP tools can load.

## Let Your Agent Install It

If you are already inside an AI coding agent, you can paste this:

> Install agent-primer from https://github.com/itsarvinddev/agent-primer. Use the global install:
> `curl -fsSL https://raw.githubusercontent.com/itsarvinddev/agent-primer/main/agent-primer.sh | bash -s -- --global`.
> Tell me what files you changed and remind me to restart this agent or IDE afterward.

The agent should announce commands before running them, because installation changes files on your
machine.

## What Happens During Setup

Agent-Primer adds marked instruction blocks, and where an agent supports them, startup hooks. The
installer is idempotent, so running it again updates the same blocks instead of duplicating them.

At session start, the CodeGraph hook checks whether the project is ready:

```text
session starts
  -> is the codegraph CLI installed?
  -> is this project indexed with .codegraph/?
  -> if setup is missing, bootstrap CLI/MCP/index first
  -> if setup is done, stay quiet
```

Installed hooks run in bootstrap mode by default. On a new repo they try to create the local
`.codegraph/` index before the agent answers the first task. If the CLI itself is missing, the hook
tries to install CodeGraph, register its MCP server, and build the repo index. If a command needs
approval or fails because of PATH/network/permissions, the agent is told to run the exact setup
commands first, then continue the original task. Once a project has a `.codegraph/` index, the hook
becomes quiet by default.

The bootstrap is built to never get in your way:

- Every step is time-bounded, so a dead network or a hung daemon cannot stall session start.
- If indexing a large repo outruns its budget, it keeps indexing in the background and the agent is
  told to proceed and check `codegraph status` before relying on the index.
- Auto-install and auto-index only happen inside a git repository (never in `$HOME` or scratch
  folders), and a freshly created index is gitignored automatically.
- A failed CLI install is not retried for an hour, so an offline machine gets fast session starts.
- The hook repairs the common `~/.local/bin` PATH gap that GUI-launched agents inherit, instead of
  concluding CodeGraph "is not installed".

Prefer that hooks never install or index anything by themselves? Install with `--no-bootstrap` and
they will only print the exact commands for the agent to run through its normal approval flow.

If you installed Primer, Agent-Primer also wires a local style-memory loop:

```text
session starts
  -> Primer injects a short style brief
agent edits code
  -> safe edit signals can be captured locally
agent learns later
  -> durable preferences are recorded in .primer/ or ~/.primer/
```

Primer has no cloud service, no bundled model, no telemetry, and no network sync. The user's own
agent does any learning work from local signals.

## Day-To-Day Use

After setup, use your coding agent normally. On a new repo, the first agent session should bootstrap
CodeGraph and then continue the requested task. You should not have to turn a project-analysis prompt
into a separate setup conversation.

If the CodeGraph MCP tools are not available yet, restart the agent or IDE. Until then, the
`codegraph` command-line tool can still be used directly.

If Primer is installed, you can record preferences yourself:

```bash
primer record --category testing --statement "Use vitest for unit tests" --language typescript
primer show
primer status
```

Agents can also use Primer's MCP tools after restart:

- `primer_apply` asks for relevant style preferences before editing.
- `primer_record` stores a durable preference you stated or demonstrated.
- `primer_query` searches saved preferences.
- `primer_learn` turns recent local edit signals into candidate preferences.
- `primer_impact` explains which style facts or preferences relate to a file.
- `primer_status` reports local style-memory health.

## Install Options

Common examples:

```bash
# Install for all supported agents and all projects
./install.sh --global

# Install inside one project
./install.sh --project .

# Install only for selected agents
./install.sh --global --agents claude,codex,cursor

# Preview changes without writing files
./install.sh --global --dry-run

# Hooks instruct only; never auto-install or auto-index at session start
./install.sh --global --no-bootstrap

# Add optional bundles
./install.sh --global --with mcp,rules

# Add Primer when using the bash installer
./install.sh --global --with primer
```

Available optional bundles:

| Bundle | What it adds |
|---|---|
| `mcp` | Recommended MCP servers such as Context7, GitHub, and Playwright |
| `tools` | Helpful CLI tools such as ast-grep and repomix |
| `rules` | Security, 12-Factor Agents, and commit/PR hygiene guidance |
| `skills` | Extra public skill registries |
| `agent-extensions` | Agent-specific extension and plugin guidance |
| `primer` | The local Primer coding-style engine; requires Node 22.13 or newer |

`--with all` installs the general optional bundles, but not `primer`. Primer is separate because it
has a Node requirement.

## Supported Agents

| Agent | What Agent-Primer can wire |
|---|---|
| Claude Code | Instructions, rules, hooks, MCP setup |
| Codex | `AGENTS.md`, hooks, MCP setup |
| Cursor | Cursor rules, hooks, MCP setup |
| Gemini CLI | `GEMINI.md`, hooks, MCP setup |
| opencode | `AGENTS.md` (primary carrier), best-effort plugin hook, MCP setup |
| Antigravity | `GEMINI.md`/`AGENTS.md` and rules; it has no session-start hook event |
| Kimi Code | Skills and global hook support (honors `KIMI_CODE_HOME`) |
| Qoder | Rules and instructions; no session-start hook event |

Exact file locations differ by global vs project install, but the installer prints what it writes.

## Uninstall

Remove the global setup:

```bash
./uninstall.sh --global
```

Remove a project setup:

```bash
./uninstall.sh --project /path/to/repo
```

If you installed through `npx`, you can also run:

```bash
npx @agent-primer/primer teardown --global
```

Uninstall removes Agent-Primer's wiring. It does not remove tools you may use elsewhere, such as the
CodeGraph CLI. Primer's learned style database is kept by default; pass `--purge` if you want to
delete it too.

## Files In This Repo

| Path | Purpose |
|---|---|
| `install.sh` | Main installer |
| `uninstall.sh` | Reverses an install |
| `agent-primer.sh` | Single-file portable installer |
| `make-portable.sh` | Regenerates `agent-primer.sh` after edits |
| `codegraph-session-check.sh` | Safe session-start check for CodeGraph |
| `*-policy.md` | Instruction blocks copied into agent config files |
| `primer/` | The Primer npm package and local style-memory engine |
| `tests/smoke.sh` | Install/uninstall smoke tests |

## Development

```bash
./tests/smoke.sh
./make-portable.sh

cd primer
npm ci
npm test
```

If you change the installer, policy files, or hook script, run `./make-portable.sh` so
`agent-primer.sh` stays in sync.

## Privacy

Agent-Primer itself is a local installer. Primer, when enabled, stores its database in `.primer/` for
a project or `~/.primer/` globally. It skips common secret, dependency, build, and generated files,
scrubs secret-looking excerpts, and does not send anything to a server.

## Credits

Agent-Primer wires helpful upstream projects into your agents. It does not replace them:

- [CodeGraph](https://github.com/colbymchenry/codegraph) for local code-structure indexing.
- [Superpowers](https://github.com/obra/superpowers) for the skills plugin and methodology.
- The Karpathy coding guidelines adapted from
  [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills).

## License

MIT. See [LICENSE](LICENSE).
