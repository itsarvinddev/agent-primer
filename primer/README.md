# primer

A local-first personal coding-intelligence engine: it learns your coding style from your
edits and serves it to AI coding agents over MCP, so they write code the way *you* do.
100% local — no model, no network, no telemetry. *What CodeGraph is for code structure,
primer is for your coding taste.*

> Ships in the agent-primer kit (`--with primer`, or `npx @agent-primer/primer setup`) or
> standalone via npm. See [DESIGN.md](DESIGN.md) for the architecture and the learning loop.

## Requirements
- Node ≥ 22.5 (uses the built-in `node:sqlite`; the launcher handles the
  `--experimental-sqlite` flag automatically on Node 22.5–23.x).

## Install
```sh
npx @agent-primer/primer setup --global   # wire primer + the 3 core policies into your agents
npm i -g @agent-primer/primer             # …or just the `primer` CLI
npx @agent-primer/primer --help           # …or run ad-hoc, no install
```

## Use
```sh
primer init                 # create the style-graph (.primer/primer.db)
primer install              # register the MCP server into detected agents
                            # (restart your agent so primer_* tools load)
primer record --category testing --statement "Use vitest for unit tests" --language typescript
primer show                 # the merged style brief
primer learn                # bounded digest of pending edit-signals
primer impact --file src/app.ts
primer status -j
```

## Build from source (dev)
```sh
npm ci && npm run build      # -> dist/bin/primer.js
npm test                     # 38 tests incl. a spawned-stdio MCP test + multi-language AST
```

### How agents use it
- **Apply** — a SessionStart hook injects a bounded `[Primer]` brief every session; `primer_apply`
  (MCP) fetches scoped preferences on demand.
- **Capture** — a PostToolUse hook pipes each edit to `primer signal` (privacy-gated; secrets and
  generated/dependency files are never captured).
- **Distill** — when signals accrue, the agent calls `primer_learn` and records the durable ones
  with `primer_record`. Distillation uses *your* agent's tokens; it's opt-in and throttled.

## Commands
`init` · `status` · `record` · `show` · `brief` · `query` · `list` · `forget` · `signal` ·
`learn` · `impact` · `install` / `uninstall` · `serve --mcp`. Run any with `--help`.

```sh
node dist/bin/primer.js impact --file src/app.ts   # the file's AST style facts + governing prefs
node dist/bin/primer.js impact --id 3              # a preference's conflicts/supersedes/co-occurs
```

## AST observations (Stage C)
Edit-signals are parsed with `web-tree-sitter` across **~22 languages** (TS/TSX/JS/Python/Go/Rust/
Java/C/C++/C#/Ruby/PHP/Swift/Kotlin/Scala/Lua/Bash/Elixir/OCaml/Objective-C/Solidity) into structured
observations. Universal markers (**identifier-naming case** — camelCase/snake_case/PascalCase/
UPPER_SNAKE for value vs type names — plus quotes and comments) work for every language; rich markers
(var→const, type annotations, async/await vs `.then`, import style, try/catch, docstrings) apply to
TS/JS/Python. `primer learn` aggregates them into **ranked candidate preferences**, so the agent
records evidence-backed rules. Grammars are loaded lazily (only by `learn`/`impact`), so
`signal`/`brief`/`record` stay fast.

## Install without the repo (npx-ready)
The published package ships `dist` + docs + the bundled bash kit; its deps (incl. the WASM grammars
via `tree-sitter-wasms`) resolve on install, so it runs standalone — no clone needed:
```sh
npx @agent-primer/primer setup --global   # wire primer + the core policies into your agents
npm i -g @agent-primer/primer             # …or just the CLI
```
To hack on it locally: `npm pack` then `npm i ./agent-primer-primer-*.tgz`.

## Privacy
The DB lives in a gitignored `.primer/` (project) or `~/.primer/` (global). Signals only ever
come from recognized source files, exclude secrets/generated/dependency files, and have their
excerpts secret-scrubbed and size-capped. Nothing is transmitted anywhere.
