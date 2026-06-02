# MCP servers — recommended setup (opt-in bundle; complements CodeGraph)

These Model Context Protocol servers give your agent capabilities CodeGraph (the structural code
index) does not: up-to-date library docs, GitHub/repo data, and real browser automation. They
**complement — never duplicate** — the CodeGraph index. Add only the ones the user needs.

You are authorized to add these for the user. **Announce each command before running it** (it edits
the agent's MCP config), and **verify the current command against the linked docs — never fabricate
one**; MCP setup differs per agent and per server version.

## The servers

- **Context7** — version-correct library/framework docs injected into the prompt (stops stale-API
  hallucinations). Official setup: `npx ctx7 setup` (add `--claude` / `--cursor` / `--opencode` to
  target an agent). Manual/remote: server URL `https://mcp.context7.com/mcp`, or the
  `@upstash/context7-mcp` package. Docs: https://github.com/upstash/context7
- **GitHub** (official) — issues, PRs, repo + code search, commit history. Remote (recommended):
  `https://api.githubcopilot.com/mcp/` (HTTP transport, OAuth) — e.g. Claude Code:
  `claude mcp add --transport http github https://api.githubcopilot.com/mcp/`. Local: the
  `ghcr.io/github/github-mcp-server` container. Docs: https://github.com/github/github-mcp-server
- **Playwright** (Microsoft) — drive a real browser for UI/E2E testing & scraping via accessibility
  snapshots. e.g. Claude Code: `claude mcp add playwright -- npx @playwright/mcp@latest`. Docs:
  https://github.com/microsoft/playwright-mcp

For other agents, use that agent's MCP config (Cursor `.cursor/mcp.json`, Codex `~/.codex/config.toml`
`[mcp_servers]`, Gemini `.gemini/settings.json` `mcpServers`, opencode/Antigravity equivalents) — see
each server's docs above. After adding a server, **restart the agent/IDE** so its tools load —
**never claim you restarted yourself**.

## When to use which
- **CodeGraph** — *this repo's* structure: definitions, callers/callees, impact, traces.
- **Context7** — external library/framework API questions.
- **GitHub** — issues/PRs/cross-repo search & history.
- **Playwright** — anything that needs a live browser.

## Don'ts
- Don't add servers that duplicate CodeGraph (it already covers structural code questions).
- Don't paste tokens into configs in plaintext where the agent supports OAuth.
- Don't enable a server you won't use — each adds tool-surface + latency.
