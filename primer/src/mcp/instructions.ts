// Sent to the agent on MCP `initialize`. Kept short — the agent reads it every
// session. The SessionStart hook is the PRIMARY apply channel; these tools enrich.

export const SERVER_INSTRUCTIONS = `primer is your local, private coding-style memory (no model, no network).

When to call each tool:
- primer_apply — BEFORE writing or editing code, fetch the user's relevant style preferences
  (pass language/context to scope them) and apply them alongside project conventions.
- primer_record — when the user CORRECTS your code or STATES a durable preference, record it
  (controlled category, one terse imperative line). Announce the call. Record only durable habits.
- primer_learn — when told signals are pending, get a bounded digest of recent edits and then
  primer_record the durable preferences it reveals (skip anything already recorded).
- primer_impact — analyze impact: {preference: id} returns its graph neighbors (conflicts /
  supersedes / co-occurs); {file} or {code} returns the file's AST style facts + which recorded
  preferences govern it (followed vs related). Use before changing a rule, or to see what style
  governs a file.
- primer_query / primer_status — search the style memory / check its health.

Distillation spends the USER's tokens (primer has no model of its own), so keep primer_learn bounded
and don't over-record near-duplicates.

If results look empty or wrong for the project you're in, the MCP host may have launched this server
outside the project: retry the call with projectPath: "<absolute project root>".`;
