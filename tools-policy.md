# Code tools — ast-grep + repomix (opt-in bundle; companions to the CodeGraph CLI)

Two CLI tools that make edits precise and context-gathering cheap. Install only what's missing
(`command -v <tool>`), **announce the install command first**, and **verify it against the linked
docs — don't fabricate**.

## The tools
- **ast-grep** (`ast-grep` / `sg`) — AST-aware structural search & rewrite across many languages;
  ideal for safe codemods ("rewrite this call pattern everywhere") that regex can't do reliably.
  Install: `brew install ast-grep` · `npm install --global @ast-grep/cli` · `cargo install ast-grep --locked`.
  Docs: https://github.com/ast-grep/ast-grep
- **repomix** — pack a repo (or a subtree) into one LLM-friendly file with token counts; use to hand
  an agent whole-repo context where no index exists. No install needed: `npx repomix@latest`
  (or `npm install -g repomix` / `brew install repomix`). Docs: https://github.com/yamadashy/repomix
- **ripgrep (`rg`)** and **jq** are assumed present (fast text search / JSON munging). Install if
  missing: `brew install ripgrep jq`.

## When to use which
- **CodeGraph** — structural questions on an *indexed* repo (callers/callees/impact/traces). Prefer it.
- **ast-grep** — syntax-aware find/rewrite (codemods), or any repo that isn't indexed.
- **ripgrep** — fast literal/regex text (comments, strings, TODOs) where structure doesn't matter.
- **repomix** — bulk "give me the whole repo" context export.

## Don'ts
- Don't grep/ast-grep for a structural question a fresh CodeGraph index answers better.
- Don't `npm i -g` / `brew install` silently — announce the command first.
