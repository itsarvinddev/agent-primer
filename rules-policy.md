# Security + architecture + hygiene guardrails (opt-in bundle; additive to the Karpathy guidelines)

The Karpathy guidelines cover code quality. These add three orthogonal concerns. Apply them on
relevant work — they're principles, not commands to run.

## Security (OWASP-distilled)
- Treat all external input as hostile: parameterize SQL, avoid shell-string interpolation, encode
  output for its sink (HTML / SQL / shell / URL).
- Never log, print, or commit secrets; load them from env / a secret store; keep them out of git.
- Check **authentication AND authorization** on every protected path — they're different things.
- Guard deserialization, file paths (no traversal), and redirects against untrusted values.
- Pin and verify dependencies; don't add a package without a reason.

## Architecture (12-Factor Agents)
- Own your prompts and your context window; treat tool calls as structured outputs.
- Prefer small, focused, composable units over one mega-agent; keep control flow explicit.
- Compact errors into context and recover; put a human in the loop for risky/destructive actions.
- Keep state explicit and serializable so runs are resumable. Reference:
  https://github.com/humanlayer/12-factor-agents

## Commit / PR hygiene
- Small, focused commits; imperative subject line; explain *why* in the body.
- One logical change per PR, with tests + a clear description.
- No unrelated drive-by edits (this reinforces the Karpathy "surgical changes" rule).
- Follow the repo's own commit conventions (e.g. its trailer / co-author policy).

## Don'ts
- Don't bolt on security theater beyond the task's real threat model.
- Don't reformat or refactor unrelated code in the name of "hygiene."
