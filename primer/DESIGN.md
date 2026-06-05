# primer — design

> **Status: stable.** primer lives in `primer/` and ships in the agent-primer kit
> (`--with primer`) or standalone as the
> [`@agent-primer/primer`](https://www.npmjs.com/package/@agent-primer/primer) npm package.
>
> **Try it:** `npx @agent-primer/primer` · `npm i -g @agent-primer/primer` · or
> `agent-primer install --with primer` to wire it into your agents.

## What it is

primer is a **local-first personal coding-intelligence engine**. *What CodeGraph is for
code structure, primer is for your coding taste.* It learns a developer's personal style
from their edits and serves it to every AI coding agent so the agent writes code the way
*you* do — the "With Taste" half of the idea, built open and offline.

It is **not** a model. primer ships zero ML. The user's own AI agent is the brain: primer
captures signals, stores a queryable knowledge graph, and hands the agent a bounded digest
to distill. Everything is on disk; nothing leaves the machine.

(The name "Taste" belongs to Command Code's proprietary `taste-1`; primer is an independent,
open, local take on the same problem, branded as the agent-primer kit's namesake.)

## The loop

```
   session start ──► [Primer] style brief injected (SessionStart hook)  ──► agent writes in your style
        ▲                                                                          │
        │                                                                          ▼
   primer_learn  ◄── "N pending signals" nudge ◄── signals table ◄── PostToolUse hook captures the edit
   (agent distills a bounded digest → primer_record durable preferences)
```

1. **Apply.** A SessionStart hook injects a compact, bounded `[Primer]` brief (top preferences
   by decayed weight). This is the *primary* channel — it lands every session, pre-restart, in
   every agent, and never depends on the agent choosing to call a tool. `primer_apply` (MCP) is
   the on-demand, category/language-scoped enrichment fetch.
2. **Capture.** A PostToolUse hook pipes the agent's edit payload to `primer signal` (one short
   INSERT). The edit's before/after comes from the **payload** (Edit `old_string`/`new_string`,
   Write content) — never `git show HEAD:` (which mis-attributes dirty/staged/untracked work).
   Every signal passes the privacy gate (below).
3. **Distill.** When signals accrue, the SessionStart brief appends a nudge; the agent calls
   `primer_learn`, gets a **bounded digest** (≤30 signals → ≤8 candidate preferences + the
   existing prefs so it can dedup). Each signal's before/after is parsed (tree-sitter) into
   structured **observations**, aggregated into **ranked candidate preferences** (by support), so
   the agent records evidence-backed rules. Building the digest *consumes* the signals (marks them
   processed) so they never resurface. Distillation spends the **user's** tokens (primer has no
   model), so it is opt-in + throttled.

### Why agent-pulled, not Stop-hook-pushed
A Stop hook fires *after* the turn ends — it cannot commission fresh model work — and most
target agents don't have one. So distillation is a normal in-band tool call (`primer_learn`)
the agent makes when prompted, which works identically across all agents.

### Honest constraint — accept/reject
primer runs as a hook + MCP server; it can't observe IDE inline-completion accept/reject. File
edits are captured exactly; "accept/reject" is *approximated* — an agent edit the user later
rewrites is a correction, an edit left intact is an accept. There is no telemetry and no RL.

## Architecture

TypeScript/Node, mirroring CodeGraph's proven stack — **zero native build, no model, no network**:

| Concern | Choice | Notes |
|---|---|---|
| Store | `node:sqlite` (WAL + optional FTS5) | built into Node ≥ 22.13; no native npm module. If FTS5 is unavailable, Primer falls back to table-scan search/dedup over the small local preference set. |
| MCP | `@modelcontextprotocol/sdk` over **stdio** | raw `Server` + JSON-Schema tools (no zod) |
| CLI | `commander` | `init/status/record/show/brief/query/list/forget/signal/learn/install/serve` |
| Launcher | `src/bin/primer.ts` | re-execs with `--experimental-sqlite` + `NODE_NO_WARNINGS` only if an older Node needs it (a no-op on Node 24+); **stdout is JSON-RPC only** in `serve --mcp` |

### Data dir
primer owns `<git-root>/.primer/primer.db` (project, gitignored) and `~/.primer/primer.db`
(global), separate from the kit — so uninstalling the kit never deletes your learned taste.
Reads merge project over global.

### The style-graph (`src/db/schema.ts`)
- `preferences` — `UNIQUE(category, statement)` makes `record` an idempotent **upsert**.
  `category` is a **controlled enum** (`naming, formatting, imports, types, error-handling,
  async, testing, comments, tooling, structure`), rejected at write. `weight` accumulates on
  reinforcement and **decays by recency** (read-time) so stale one-offs fade.
- `tags` — language/framework/topic relations for context retrieval.
- `pref_edges` — `conflicts`/`supersedes`/`co_occurs` between preferences (the graph; powers
  conflict resolution so the brief never emits two contradictory rules).
- `signals` — raw edits; excerpts are secret-scrubbed and capped (≤2 KB / 40 lines).
- `preferences_fts` — optional FTS5 external-content index + triggers, for faster search + the near-dup gate when available.

### The contract (quality controls — schema dedup isn't enough)
`primer_record` enforces: enum category; one-line imperative (no newlines, ≤200 chars);
durable-only (rejects task-specific wording); a **near-dup gate** (FTS5 when available, otherwise a
bounded table scan, plus Jaccard ≥ 0.5 → returns "reinforce/supersede/force" instead of inserting a sibling); explicit **supersede**
(forget old + edge); and a light **polarity conflict** heuristic that records a `conflicts` edge.

### Privacy gate (`src/learn/privacy.ts`)
A file becomes a signal only if it is a recognized **source file**, **not** in a deps/build dir,
**not** a secret file (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `secrets.*`, …), **not** generated,
and ≤ 1 MB. Excerpts are **secret-scrubbed** (AWS/GitHub/Slack/Google keys, PEM blocks, bearer
tokens, `key=…` assignments) and **size-capped** before storage.

### AST extraction (`src/extract/`, Stage C)
Signals are parsed with **`web-tree-sitter`** (WASM grammars loaded as bytes — verified on Node 26,
no V8 flags). Two layers:
- **Universal** (all **~22 languages**: TS/TSX/JS/Python/Go/Rust/Java/C/C++/C#/Ruby/PHP/Swift/Kotlin/
  Scala/Lua/Bash/Elixir/OCaml/Objective-C/Solidity) — extracted by generic node-type matching:
  **identifier-naming case** (camelCase / snake_case / PascalCase / UPPER_SNAKE, for value vs type
  names, emitted only when a case strongly dominates), quote style, and comments.
- **Rich** (TS/JS/Python) — var→const, arrow vs declaration, type annotations, async/await vs
  `.then`, named vs default imports, try/catch, docstrings.

`observeEdit(before, after)` yields candidate preferences with evidence (structural changes + naming
state); `observeFile(code)` yields a file's dominant facts. Grammars are lazy-loaded only by
distill/impact/observe, so the hot paths never pay the cost. The digest aggregates observations into
**ranked candidates** (by support count) so the agent records evidence-backed preferences.

### MCP tools (6)
`primer_apply` · `primer_record` · `primer_query` · `primer_learn` · `primer_status` ·
**`primer_impact`**. The MCP `command` is an **absolute** `node <abs>/dist/bin/primer.js serve
--mcp` (there is no released binary on `PATH`), written by `primer install` after validating the
build exists. `primer_impact` is real and well-defined: `{preference: id}` → its graph neighbors
(conflicts / supersedes / superseded-by / co-occurs) + signal support; `{file|code}` → the file's
AST style facts + which recorded preferences govern it (followed vs related). (This is *style*
impact; code-structure impact — callers/callees — would reuse CodeGraph and is a later integration.)

## Roadmap

- **Stage A — Spine** ✅ *(shipped)* — style-graph, CLI, MCP tools, per-agent installer,
  the SessionStart brief, `primer_apply`/`primer_record`.
- **Stage B — Auto-learning** ✅ *(shipped)* — PostToolUse signal capture (privacy-gated),
  bounded agent-pulled `primer_learn` distillation.
- **Stage C — AST + impact** ✅ *(shipped)* — `web-tree-sitter` observations across **~22 languages**
  with **identifier-naming** (value/type case), ranked AST candidates in the digest, and a real
  `primer_impact`. *Still open within C:* a CodeGraph-backed *code-structure* impact mode
  (callers/callees) and richer per-language markers beyond TS/JS/Python.
- **Stage D — Distribution** ✅ *(published)* — live on npm as
  [`@agent-primer/primer`](https://www.npmjs.com/package/@agent-primer/primer); `npx @agent-primer/primer`
  runs from a clean install (deps + WASM grammars resolve, no repo). The kit's `--with primer` resolves
  primer via an installed CLI > repo build > `npm i -g`, and CI runs the suite on Node 24/latest ×
  ubuntu+macOS. *Remaining:* a bundled-Node single binary, and a `1.0` milestone against
  the bar below.

## Distribution
The package (`@agent-primer/primer`, scoped) ships only `dist` + docs; `tree-sitter-wasms`,
`@modelcontextprotocol/sdk`, `commander`, and `web-tree-sitter` are runtime deps resolved on install,
so the WASM grammars come from the installed dependency (no vendoring). `node:sqlite` is built into
Node ≥ 22.13; FTS5 is used opportunistically. To use without the repo: `npm i @agent-primer/primer` or
`npm i ./agent-primer-primer-*.tgz` from a local `npm pack`.

## The bar to `1.0` (when all hold)
- Across ≥ 3 real repos and ≥ 2 developers, with-primer vs without **reduces style-correction
  round-trips by a target %** on a fixed rubric.
- Distillation costs **≤ a set token budget per session**.
- **Zero P0/P1 regressions** to the core agent-primer kit over a 2-week dogfood.
- Stages A–C complete with green tests on Node 24–latest.

## Non-goals (v1)
No cloud/sync, no telemetry, no ML model, no IDE-signal capture, no 20-language AST yet, no
`primer_impact`. Each is a later stage or an explicit constraint, documented above.
