# Skill registries — beyond Superpowers (opt-in bundle)

Superpowers (in the default bundle) is one skill library. These are additional sources of
installable, agent-agnostic skills. **Announce installs; verify the command against the source —
never fabricate one.**

- **Anthropic official skills** — first-party skills (document handling, `mcp-builder`,
  `webapp-testing`, `skill-creator`, …) in the open `SKILL.md` format. Browse/install from
  https://github.com/anthropics/skills — via your agent's plugin marketplace, or by copying a
  `SKILL.md` into your skills directory.
- **skills.sh registry** — the agent-agnostic installer/discovery layer:
  `npx skills add <owner>/<repo>` writes the skill files into your skills directory. Browse:
  https://skills.sh
- **VoltAgent — awesome-agent-skills** — a large, *curated* (hand-picked, not AI-generated)
  collection, strong on security (Trail of Bits) and vendor SDKs:
  https://github.com/VoltAgent/awesome-agent-skills

## How to choose
Prefer official (Anthropic) → curated (VoltAgent) → community. Install via skills.sh for any agent
that isn't plugin-native. A restart may be needed for new skills to load — **never claim you
restarted yourself**; ask the user.

## Don'ts
- Don't bulk-install skills you won't use (context + maintenance cost).
- Don't trust an uncurated / AI-generated skill without reading it first.
