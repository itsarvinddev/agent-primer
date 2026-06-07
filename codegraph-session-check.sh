#!/usr/bin/env bash
# codegraph-session-check.sh — CodeGraph session-startup check for AI coding agents.
#
# Part of the portable "agent-primer" kit. Wired as a SessionStart hook
# (Claude Code, Codex, Gemini, Antigravity, Kimi), a sessionStart hook (Cursor),
# or invoked from a session.created plugin (opencode). Safe to run standalone.
#
# It NEVER mutates anything and ALWAYS exits 0 — it only inspects the index and
# emits a directive telling the agent what to do (install / init / proceed).
# The agent performs any install itself, per codegraph-policy.md, announcing commands.
#
# By DEFAULT it runs in "once per project" mode: it nudges every session UNTIL the
# project is set up (CLI present + .codegraph/ at the project root), then goes SILENT
# on later sessions (emits nothing; skips `codegraph status` for a fast no-op). Index
# freshness after that is handled by CodeGraph's own file-watcher. Pass --always to
# restore the legacy every-session behavior (print `codegraph status` + a reminder
# even when the index is already present).
#
# Usage:
#   codegraph-session-check.sh [--format text|json|cursor] [--project DIR] [--always]
#
# Formats:
#   text    plain stdout (default; Claude Code / Codex add SessionStart stdout to context)
#   json    {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}
#   cursor  {"additional_context":"…"}
#
# --always  every-session mode: branch 3 prints status as before (default: silent once set up)

set -u

FORMAT="text"
PROJECT_DIR=""
ALWAYS=0

while [ "$#" -gt 0 ]; do
  # NOTE: `shift 2` fails and shifts nothing on bash 3.2 when the flag is the last
  # arg → infinite loop. As a SessionStart hook that would hang the agent's startup,
  # so use a guarded double-shift instead.
  case "$1" in
    --format) FORMAT="${2:-text}"; shift; [ "$#" -gt 0 ] && shift ;;
    --format=*) FORMAT="${1#*=}"; shift ;;
    --project) PROJECT_DIR="${2:-}"; shift; [ "$#" -gt 0 ] && shift ;;
    --project=*) PROJECT_DIR="${1#*=}"; shift ;;
    --always) ALWAYS=1; shift ;;
    *) shift ;;
  esac
done

# Resolve the project directory: explicit flag > known hook env vars > CWD.
if [ -z "$PROJECT_DIR" ]; then
  PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${CODEX_PROJECT_DIR:-${PWD:-.}}}"
fi

INSTALL_SH="curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh"

# --- helpers ---------------------------------------------------------------

run_status() {
  # Bounded so a hung daemon can never block session start.
  if command -v timeout >/dev/null 2>&1; then
    timeout 8 codegraph status 2>&1
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout 8 codegraph status 2>&1
  else
    codegraph status 2>&1
  fi
}

json_escape() {
  # Emit "$1" as a JSON string literal (surrounding quotes included).
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -Rs .
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$1" | python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.stdin.read()))'
  else
    printf '%s' "$1" | awk '
      BEGIN { ORS=""; print "\"" }
      { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t") }
      { if (NR > 1) printf "\\n"; printf "%s", $0 }
      END { print "\"" }'
  fi
}

emit() {
  # $1 = message. Render it in the requested format, then exit 0.
  case "$FORMAT" in
    json)
      printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$(json_escape "$1")"
      ;;
    cursor)
      printf '{"additional_context":%s}\n' "$(json_escape "$1")"
      ;;
    *)
      printf '%s\n' "$1"
      ;;
  esac
}

# --- checks ----------------------------------------------------------------

if ! command -v codegraph >/dev/null 2>&1; then
  emit "[CodeGraph] The \`codegraph\` CLI is NOT installed in this environment.
Do NOT leave this as a passive note. Before substantive work, ask using the host's structured
prompt/confirmation dialog when one is available (the same kind of UI used for permissions or
command approvals, such as a request_user_input or confirm tool). If no such tool exists, ask this
direct yes/no question in chat:

  CodeGraph is not installed yet. Want me to install it and index this repo now? I will run:
    ${INSTALL_SH}
    codegraph install -y
    codegraph init -i

If the user says yes, announce each command, run the three commands, then ask them to RESTART this
agent/IDE so the codegraph_* MCP tools load. (Use \`codegraph install -y\`: a bare \`codegraph
install\` prompts interactively and hangs without a TTY.) After the restart, VERIFY the codegraph_*
tools loaded; if they are missing, the binary is usually in ~/.local/bin off the agent's PATH — add
it to PATH or re-register the MCP server's command with the absolute path. Until restart, use the
\`codegraph\` CLI directly.
If the user says no, proceed without CodeGraph and mention that structural code answers may be weaker."
  exit 0
fi

if [ ! -d "$PROJECT_DIR/.codegraph" ]; then
  emit "[CodeGraph] CLI present, but this project is NOT initialized (no .codegraph/ at
${PROJECT_DIR}).
Do NOT leave this as a passive note. Before substantive work, ask using the host's structured
prompt/confirmation dialog when one is available (the same kind of UI used for permissions or
command approvals, such as a request_user_input or confirm tool). If no such tool exists, ask this
direct yes/no question in chat:

  CodeGraph is installed, but this repo is not indexed yet. Want me to run \`codegraph init -i\` now?

If the user says yes, announce and run \`codegraph init -i\`. If the codegraph_* MCP tools are
missing afterwards, run \`codegraph install -y\` and ask the user to restart this agent/IDE.
If the user says no, proceed without CodeGraph and mention that structural code answers may be weaker."
  exit 0
fi

# Branch 3: CLI present + .codegraph/ exists = this project is already set up.
# DEFAULT (once-mode): stay SILENT and skip `codegraph status` entirely — a fast no-op.
# Freshness is the file-watcher's job; re-announcing every session is just noise.
# Pass --always to restore the legacy every-session status + reminder output.
if [ "$ALWAYS" = 0 ]; then
  exit 0
fi

ESC="$(printf '\033')"
STATUS_OUT="$(run_status | sed "s/${ESC}\[[0-9;]*m//g")"
emit "[CodeGraph] Index present. \`codegraph status\`:
${STATUS_OUT}

If the index looks behind (pending/changed/stale files above), run \`codegraph sync\`
before relying on codegraph_* results. Prefer codegraph_* tools for structural questions
(definitions, callers/callees, impact, traces) over a grep + read loop."
exit 0
