# primer — your local coding-style memory (every session, every agent)

primer is a local-first personal coding-intelligence engine wired by agent-primer's
`--with primer`. It learns your personal coding style from your edits and serves it over **MCP**,
so the agent writes code the way **you** do. 100% local — no model, no network, no telemetry.
*What CodeGraph is for code structure, primer is for your coding taste.* Opt-in via
`--with primer` (or the `@agent-primer/primer` package); needs Node ≥ 22.5.

## Use the `primer_*` MCP tools (available after a restart)
- **Before** writing or editing code, call **`primer_apply`** (pass language/context) and apply the
  returned preferences alongside the project's own conventions.
- When the user **corrects** your code or **states** a durable preference ("always X", "prefer Y",
  "don't Z"), call **`primer_record`** — a controlled category + one terse imperative line.
  **Announce it** before running.
- When a `[Primer]` note says signals are pending, call **`primer_learn`** for a bounded digest of
  recent edits, then `primer_record` the durable preferences it reveals (skip ones already there).
- **`primer_query`** / **`primer_status`** search / report the style memory.

## The `[Primer]` session brief
A SessionStart hook injects a bounded `[Primer]` style brief each session (Claude / Cursor / Gemini /
Codex / Antigravity / opencode, and Kimi on `--global`, in this build). Treat it as the
user's coding-style preferences and apply them. Project conventions and explicit in-session
instructions win over the stored brief.

## Guardrails
- **Only record durable, real preferences** — never task-specific one-offs, never your own opinion.
- **Never fabricate** — an empty primer is correct until the user expresses taste.
- **Announce** any `primer_record` before running it.
- **Distillation spends YOUR tokens** (primer has no model of its own) — keep `primer_learn` bounded;
  don't over-record near-duplicates (the store will ask you to merge instead).
- **Restart reality**: the `primer_*` MCP tools load only after the agent/IDE restarts. You cannot
  restart yourself — ask the user. The `[Primer]` session brief works without a restart.

## Privacy
The style DB lives in a gitignored `.primer/` (project) or `~/.primer/` (global). Signals come only
from source files (secrets, generated, and dependency files are skipped), and excerpts are
secret-scrubbed and size-capped. Nothing leaves the machine.

## Don'ts
- Don't claim the `primer_*` tools are active before a restart — verify, or use the `[Primer]` brief.
- Don't record secrets, file paths, or one-off task details as preferences.
- Don't treat primer as authoritative over explicit project conventions or the user's in-session ask.
