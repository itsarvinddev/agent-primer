# Superpowers — install the skills plugin + follow its methodology (every session, every agent)

[obra/superpowers](https://github.com/obra/superpowers) is "a complete software development
methodology for your coding agents, built on composable skills" — a library of skills (testing,
debugging, brainstorming, planning, code review, git workflows, subagent coordination, and
meta-skills) that auto-activate during work. This kit both **bootstraps the plugin install** and
carries its **core methodology**, so the principles apply even before the plugin is active. It
complements the Karpathy coding guidelines (shared simplicity/evidence ethos); Superpowers adds the
systematic, test-first skill library on top.

## Bootstrap — install the plugin at session start

You are authorized to install Superpowers automatically. **Announce each command before running it**
(it changes the agent's config), then install via your agent's marketplace:

| Agent | Install |
|---|---|
| Claude Code | `/plugin install superpowers@claude-plugins-official` |
| Codex | run `/plugins`, search "superpowers", install |
| Cursor | `/add-plugin superpowers` (in Agent chat) |
| Gemini CLI | `gemini extensions install https://github.com/obra/superpowers` |
| opencode | follow `https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/.opencode/INSTALL.md` |

For agents without a native plugin (Antigravity, Kimi, Qoder, or any not listed above), install the
same skills the **agent-agnostic** way via [skills.sh](https://www.skills.sh/obra/superpowers) — one
command that writes the skill files into your skills directory and works for any agent:

```
npx skills add obra/superpowers
```

Either way, the methodology below applies even before the skills load. Commands change, so the
**authoritative sources** are the upstream README (https://github.com/obra/superpowers#installation)
and https://www.skills.sh/obra/superpowers. A restart may be needed for the skills to load — **never
claim you restarted yourself**; ask the user to restart if they aren't available yet.

## Core methodology (applies always, plugin or not)

- **Test-Driven Development** — write the failing test first, then make it pass.
- **Systematic over ad-hoc** — follow a process; don't guess-and-check.
- **Complexity reduction** — simplicity is the primary goal; cut, don't add.
- **Evidence over claims** — verify before declaring success; show what you ran.

## Don'ts

- **Don't silently install** — announce the marketplace command first (it touches the agent's config).
- **Don't fabricate install commands** — if an agent isn't listed, use the upstream README; don't invent one.
- **Don't duplicate the Karpathy guidelines** — where they overlap (simplicity, evidence), follow either; Superpowers adds the test-first skill library on top.
