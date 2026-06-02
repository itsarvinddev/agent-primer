# First-party agent extensions — plugins/skills per agent (opt-in bundle)

Each agent ecosystem ships its own plugins / skills / extensions. This points you at each one's
**native** mechanism. **Commands and marketplaces change often and differ by agent version — VERIFY
against the agent's current docs before running; never fabricate a command for an agent not listed.**
Announce each install; you can't restart yourself, so ask the user to restart for new extensions to
take effect.

| Agent | First-party extension mechanism |
|---|---|
| Claude Code | Plugin marketplaces: `/plugin marketplace add <owner>/<repo>` then `/plugin install <name>@<marketplace>`; plus Anthropic skills (github.com/anthropics/skills) |
| Codex | `/plugins` — search & install in-app |
| Cursor | Rules (`.cursor/rules/*.mdc`), `.cursor/mcp.json`, and Cursor's extension/MCP marketplace |
| Gemini CLI | `gemini extensions install <git-url>` · `gemini extensions list` |
| opencode | plugins under `~/.config/opencode/plugins/` (+ its plugin docs) |
| Antigravity / Kimi / Qoder | follow each tool's current plugin/skill docs — some have no marketplace yet |

## Don'ts
- Don't install marketplace plugins without announcing the command first.
- Don't assume an extension mechanism exists for an agent that isn't listed — check its docs.
- Don't duplicate what agent-primer already wired (the 3 core policies + any `--with` bundles).
