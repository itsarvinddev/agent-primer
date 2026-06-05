# primer

Primer is local coding-style memory for AI coding agents.

It learns durable preferences from your edits and corrections, stores them on your machine, and
serves them back to agents through MCP so future code feels closer to the way you like to write it.
There is no cloud service, no bundled model, no telemetry, and no network sync.

Primer is part of the Agent-Primer project, but it can also be installed directly from npm.

## Why Use It

AI coding agents can understand a repository, but they do not automatically remember your personal
taste across tools and sessions. Primer gives them a small local memory for things like:

- which test runner you prefer
- how you like imports organized
- naming and formatting habits
- when you prefer explicit types
- how much commenting or docstring detail you want
- project or language-specific style preferences

Think of it this way: CodeGraph helps agents understand code structure; Primer helps agents remember
your coding style.

## Quick Start

Install Primer and the core Agent-Primer setup for all supported agents:

```bash
npx @agent-primer/primer setup --global
```

Install only for the current project:

```bash
npx @agent-primer/primer setup --project .
```

After setup, restart your agent or IDE so the `primer_*` MCP tools can load.

Requirement: Node 22.13 or newer. The npm setup path is native Node and does not require `bash`, so
it works on Windows, macOS, and Linux.

## What Setup Does

`primer setup` wires two things:

- **Agent-Primer basics**: shared agent instructions for CodeGraph setup, careful coding habits, and
  the Superpowers methodology.
- **Primer style memory**: a local database, MCP server config, and startup hooks that give agents a
  short `[Primer]` style brief each session.

If you run setup with `npx`, any persistent hook or MCP entry is written so it can resolve Primer
again later instead of pointing at npm's temporary cache.

## Day-To-Day Use

Most of the time, you just use your agent normally.

When you state a durable preference, an agent with Primer enabled can record it. You can also record
one yourself:

```bash
primer record --category testing --statement "Use vitest for unit tests" --language typescript
```

See what Primer will tell agents:

```bash
primer show
```

Check local health:

```bash
primer status
```

## How Agents Use Primer

After restart, agents can use these MCP tools:

| Tool | Purpose |
|---|---|
| `primer_apply` | Fetch relevant preferences before editing |
| `primer_record` | Store a durable user preference |
| `primer_query` | Search saved preferences |
| `primer_learn` | Turn recent local edit signals into candidate preferences |
| `primer_impact` | Show style facts for a file or relationships for a preference |
| `primer_status` | Report local style-memory health |

The startup hook can also inject a short `[Primer]` brief automatically, so agents get useful style
context even before they decide to call a tool.

## Common Commands

```bash
primer init
primer record --category testing --statement "Use vitest for unit tests"
primer show
primer query vitest
primer learn
primer impact --file src/app.ts
primer status -j
```

Run any command with `--help` for options.

## Uninstall

Remove the global setup:

```bash
npx @agent-primer/primer teardown --global
```

Remove a project setup:

```bash
npx @agent-primer/primer teardown --project .
```

Primer keeps your learned style database by default. Use `--purge` if you also want to delete the
local `.primer/` or `~/.primer/` database.

## Privacy

Primer stores data locally in `.primer/` for a project or `~/.primer/` globally. It skips common
secret, dependency, build, and generated files. Captured excerpts are size-capped and scrubbed for
secret-looking values. Nothing is sent to a server.

## For Developers

Build and test from source:

```bash
npm ci
npm test
```

The package ships compiled `dist/`, docs, and the bundled Agent-Primer kit, so npm users do not need
to clone this repository.

More technical detail lives in [DESIGN.md](DESIGN.md).
