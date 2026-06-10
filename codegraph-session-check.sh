#!/usr/bin/env bash
# codegraph-session-check.sh — CodeGraph session-startup check for AI coding agents.
#
# Part of the portable "agent-primer" kit. Wired as a SessionStart hook
# (Claude Code, Codex, Gemini, Antigravity, Kimi), a sessionStart hook (Cursor),
# or invoked from a session.created plugin (opencode). Safe to run standalone.
#
# It ALWAYS exits 0 so it never bricks session start. With --bootstrap (the mode
# Agent-Primer wires into installed hooks), it may install/register CodeGraph and
# build the repo-local .codegraph/ index before the model sees the task. Without
# --bootstrap it stays read-only and emits command-first recovery instructions.
#
# By DEFAULT it runs in "once per project" mode: bootstrap or instruct UNTIL the
# project is set up (CLI present + index DB at the project root), then go SILENT
# on later sessions (emits nothing; skips `codegraph status` for a fast no-op). Index
# freshness after that is handled by CodeGraph's own file-watcher. Pass --always to
# print `codegraph status` every session even when the index is already present.
#
# Robustness rules this script lives by (hooks run unattended, on every host):
#   * EVERY external command is time-bounded — a hung network call or daemon must
#     never stall session start past the host's hook timeout (Kimi kills at ~10s
#     unless raised; a killed hook emits NOTHING and the agent flies blind).
#   * PATH is augmented with the usual user-bin dirs first — GUI-launched agents
#     often miss ~/.local/bin (where the CodeGraph installer links the binary),
#     which otherwise reads as "not installed" and triggers a pointless reinstall.
#   * Auto-bootstrap only ever runs inside a git repo that is not $HOME — never
#     auto-index someone's home directory or a scratch folder.
#   * A failed CLI auto-install is not retried for an hour (marker file), so a dead
#     network can't add a curl|sh attempt to every session start.
#   * If indexing outlives its time budget it continues in the BACKGROUND and the
#     agent is told to proceed and check `codegraph status` before trusting MCP.
#
# Usage:
#   codegraph-session-check.sh [--format text|json|cursor] [--project DIR] [--bootstrap] [--always]
#
# Formats:
#   text    plain stdout (default; Claude Code / Codex add SessionStart stdout to context)
#   json    {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}
#   cursor  {"additional_context":"…"}
#
# --bootstrap  install/register/index automatically before the first task when needed
# --always     every-session mode: branch 3 prints status as before (default: silent once set up)

set -u

FORMAT="text"
PROJECT_DIR=""
ALWAYS=0
BOOTSTRAP=0

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
    --bootstrap) BOOTSTRAP=1; shift ;;
    *) shift ;;
  esac
done

# A hook can be launched with a stripped environment; never let an unset HOME make
# `set -u` kill us before we could emit anything.
HOME="${HOME:-${USERPROFILE:-/tmp}}"

# Resolve the project directory: explicit flag > known hook env vars > CWD.
# (Claude/Cursor export CLAUDE_PROJECT_DIR; Gemini exports GEMINI_PROJECT_DIR;
# Cursor also CURSOR_PROJECT_DIR. Cursor GLOBAL hooks run from ~/.cursor, so the
# env vars — not PWD — are what make the global wiring correct there.)
if [ -z "$PROJECT_DIR" ]; then
  PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${GEMINI_PROJECT_DIR:-${CURSOR_PROJECT_DIR:-${CODEX_PROJECT_DIR:-${PWD:-.}}}}}"
fi
# Normalize to an absolute path so the $HOME guard and emitted hints are exact.
PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd || printf '%s' "$PROJECT_DIR")"

INSTALL_SH="curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh"

# Where the CodeGraph installer links the binary (~/.local/bin) is frequently NOT on
# the PATH a GUI-launched agent inherits. Augment PATH up front so an installed CLI
# is recognized instead of re-installed. (AGENT_PRIMER_NO_PATH_AUGMENT disables this
# for tests that need a hermetic PATH.)
if [ -z "${AGENT_PRIMER_NO_PATH_AUGMENT:-}" ]; then
  for _d in "$HOME/.local/bin" "$HOME/bin" /usr/local/bin /opt/homebrew/bin; do
    case ":$PATH:" in *":$_d:"*) ;; *) [ -d "$_d" ] && PATH="$PATH:$_d" ;; esac
  done
  export PATH
fi

# State dir for cross-session markers (install backoff). Overridable for tests.
STATE_DIR="${AGENT_PRIMER_STATE_DIR:-$HOME/.agent-primer}"
INSTALL_MARKER="$STATE_DIR/codegraph-install.last-attempt"

# Time budgets (seconds). Their sum stays well under Claude's 600s default hook
# timeout; on hosts with tighter limits the per-step bounds keep us responsive and
# the index step falls back to a background run instead of dying mid-way.
INSTALL_BUDGET=25
REGISTER_BUDGET=15
INDEX_BUDGET=20
STATUS_BUDGET=8

# --- helpers ---------------------------------------------------------------

# run_bounded SECONDS CMD ARGS… — never let a child run past its budget.
# Prefers timeout(1)/gtimeout(1); falls back to perl's alarm (macOS has no coreutils
# timeout by default); as a last resort runs unbounded. Timeout → exit 124/142.
run_bounded() {
  _secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$_secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$_secs" "$@"
  elif command -v perl >/dev/null 2>&1; then
    perl -e 'alarm shift; exec @ARGV' "$_secs" "$@"
  else
    "$@"
  fi
}

timed_out() { [ "$1" = 124 ] || [ "$1" = 142 ]; }   # GNU timeout=124, SIGALRM=142

run_status() {
  run_bounded "$STATUS_BUDGET" codegraph status 2>&1
}

# Auto-bootstrap is allowed only in a real project: a git repo that isn't $HOME.
# (Indexing a home dir or a scratch folder is slow, useless, and surprising.)
safe_to_bootstrap() {
  [ -e "$PROJECT_DIR/.git" ] || return 1
  [ "$PROJECT_DIR" != "$HOME" ] || return 1
  return 0
}

# A failed CLI install is not retried within an hour, so a broken network never
# adds a curl|sh stall to every session start.
install_recently_attempted() {
  [ -f "$INSTALL_MARKER" ] || return 1
  find "$INSTALL_MARKER" -mmin -60 2>/dev/null | grep -q .
}

mark_install_attempt() {
  mkdir -p "$STATE_DIR" 2>/dev/null && : > "$INSTALL_MARKER" 2>/dev/null
}

clear_install_attempt() {
  rm -f "$INSTALL_MARKER" 2>/dev/null
}

# The per-machine .codegraph/ index must never be committed; codegraph's own
# .codegraph/.gitignore covers files inside it but not the directory itself.
ensure_codegraph_gitignore() {
  [ -e "$PROJECT_DIR/.git" ] || return 0
  _gi="$PROJECT_DIR/.gitignore"
  if [ -f "$_gi" ] && grep -qE '^/?\.codegraph/?$' "$_gi" 2>/dev/null; then return 0; fi
  printf '\n# codegraph: local code-structure index (rebuilt per machine; do not commit)\n.codegraph/\n' >> "$_gi" 2>/dev/null || true
}

# Index this project, bounded. Exit: 0 = indexed, 2 = still indexing in background,
# 1 = failed. A repo too big for the foreground budget keeps indexing detached so
# the session starts fast and the index is ready shortly after.
bootstrap_index() {
  ( cd "$PROJECT_DIR" 2>/dev/null && run_bounded "$INDEX_BUDGET" codegraph init -i >/dev/null 2>&1 )
  _rc=$?
  if [ "$_rc" = 0 ]; then ensure_codegraph_gitignore; return 0; fi
  if timed_out "$_rc"; then
    ( cd "$PROJECT_DIR" 2>/dev/null && nohup codegraph init -i >/dev/null 2>&1 & ) 2>/dev/null
    ensure_codegraph_gitignore
    return 2
  fi
  return 1
}

bootstrap_missing_cli() {
  # 1) install the CLI (network); 2) refresh PATH (installer links ~/.local/bin —
  # which may not have EXISTED at script start, so the startup augmentation could
  # not have added it; append unconditionally now); 3) register the MCP server
  # NON-interactively; 4) index handled by the caller.
  run_bounded "$INSTALL_BUDGET" sh -c "$INSTALL_SH" >/dev/null 2>&1 || return 1
  PATH="$PATH:$HOME/.local/bin:$HOME/bin"; export PATH
  hash -r 2>/dev/null || true
  command -v codegraph >/dev/null 2>&1 || return 1
  run_bounded "$REGISTER_BUDGET" codegraph install -y >/dev/null 2>&1 || return 1
  return 0
}

# A very recent bare .codegraph/ (dir present, no db yet) usually means another
# session — or a background run this script started earlier — is indexing RIGHT
# NOW. Don't stack a second indexer on top of it; a stale bare dir (crashed init)
# falls through and is re-indexed normally.
index_in_progress() {
  [ -d "$PROJECT_DIR/.codegraph" ] || return 1
  index_initialized && return 1
  find "$PROJECT_DIR/.codegraph" -maxdepth 0 -mmin -10 2>/dev/null | grep -q .
}

MCP_RECOVERY_HINT="If a codegraph_* MCP call fails with \"No CodeGraph project is loaded\", retry it with
projectPath: \"${PROJECT_DIR}\". If it fails with \"not initialized\", run \`codegraph init -i\` in
${PROJECT_DIR} once, then retry."

emit_bootstrap_success() {
  # $1 = message. The original task should now continue without waiting on the user.
  emit "[CodeGraph bootstrap complete]
$1

Proceed with the user's original task now. Prefer codegraph_* MCP tools after restart; until then,
use the \`codegraph\` CLI directly for structural questions (definitions, callers/callees, impact,
traces, file maps). ${MCP_RECOVERY_HINT}"
}

emit_bootstrap_background() {
  emit "[CodeGraph indexing in background]
$1

Proceed with the user's original task now using native tools. Before relying on codegraph_* MCP
tools or the \`codegraph\` CLI for structural answers, check \`codegraph status\` once — the index
becomes available as soon as the background run finishes. Do not re-run \`codegraph init\`."
}

emit_bootstrap_failure() {
  # $1 = failure summary. The agent should recover by running the exact commands with normal command
  # approval UI rather than turning this into a passive note.
  emit "[CodeGraph bootstrap failed]
$1

STOP: do not inspect files, analyze project structure, or answer the user's task yet.
Your next assistant action MUST be to run the setup command(s) below using the host's normal command
approval UI if needed. Do not ask a yes/no chat question first; the command approval dialog is the
permission step. If command execution is unavailable or the user declines a command approval, say
that once and then proceed without CodeGraph.

Commands:
  ${INSTALL_SH}
  codegraph install -y
  codegraph init -i

After the commands succeed, continue the user's original task immediately using the \`codegraph\`
CLI. Never append this as an after-the-fact note once the task is already answered."
}

# Softer, non-blocking note for directories we refuse to auto-index (not a git
# repo, or $HOME itself). No STOP: this may not be a coding session at all.
emit_nonproject_note() {
  emit "[CodeGraph not set up here]
$1

This directory was NOT auto-indexed (it is not a git repository root, or it is the home
directory). If this session is about code in ${PROJECT_DIR}, run the command(s) above first via
the normal command approval UI, then continue. Otherwise just proceed with the user's task."
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
      { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, "\\r") }
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

# An initialized index = the .codegraph/ dir AND at least one SQLite db file inside it.
# We check for the db file rather than running `codegraph status` on purpose: a bare
# .codegraph/ directory left behind by an aborted/half-finished `init` would otherwise
# look "set up" and make once-mode go silent on a broken index. Running `codegraph status`
# every session is exactly the cost once-mode removes, so this cheap filesystem check is the
# right middle ground; deep corruption is still `codegraph status`/--always's job.
index_initialized() {
  [ -d "$PROJECT_DIR/.codegraph" ] || return 1
  for _db in "$PROJECT_DIR"/.codegraph/*.db; do
    [ -f "$_db" ] && return 0
  done
  return 1
}

# --- checks ----------------------------------------------------------------

if ! command -v codegraph >/dev/null 2>&1; then
  if [ "$BOOTSTRAP" = 1 ] && safe_to_bootstrap && ! install_recently_attempted; then
    mark_install_attempt
    if bootstrap_missing_cli; then
      clear_install_attempt
      bootstrap_index; _idx=$?
      if [ "$_idx" = 0 ]; then
        emit_bootstrap_success "Installed the CodeGraph CLI, registered its MCP server, and indexed this repo at ${PROJECT_DIR}."
        exit 0
      elif [ "$_idx" = 2 ]; then
        emit_bootstrap_background "Installed the CodeGraph CLI and registered its MCP server; indexing of ${PROJECT_DIR} is still running in the background."
        exit 0
      fi
      emit_bootstrap_failure "Installed the CodeGraph CLI, but indexing ${PROJECT_DIR} failed (only \`codegraph init -i\` still needs to run)."
      exit 0
    fi
    emit_bootstrap_failure "Automatic install did not complete. The CLI may need a fresh PATH, network access, or a command approval. (Auto-install will not retry for an hour; run the commands below instead.)"
    exit 0
  fi
  if [ "$BOOTSTRAP" = 1 ] && ! safe_to_bootstrap; then
    emit_nonproject_note "The \`codegraph\` CLI is NOT installed in this environment. To set it up for a real project, run:
  ${INSTALL_SH}
  codegraph install -y
  codegraph init -i   (from the project root)"
    exit 0
  fi
  emit "[CodeGraph setup required before task work]
The \`codegraph\` CLI is NOT installed in this environment.

STOP: do not inspect files, analyze project structure, or answer the user's task yet.
Your next assistant action MUST be to run these exact setup commands using the host's normal command
approval UI if needed. Do not ask a yes/no chat question first; the command approval dialog is the
permission step.

Commands:
  ${INSTALL_SH}
  codegraph install -y
  codegraph init -i

After the commands succeed, continue the user's original task immediately using the \`codegraph\`
CLI. If command execution is unavailable or the user declines a command approval, say that once and
then proceed without CodeGraph. Never append this as an after-the-fact note once the task is already
answered."
  exit 0
fi

if ! index_initialized; then
  if [ "$BOOTSTRAP" = 1 ] && index_in_progress; then
    emit_bootstrap_background "Indexing of ${PROJECT_DIR} already appears to be in progress (started moments ago by another session or a background run)."
    exit 0
  fi
  if [ "$BOOTSTRAP" = 1 ] && safe_to_bootstrap; then
    bootstrap_index; _idx=$?
    if [ "$_idx" = 0 ]; then
      emit_bootstrap_success "Indexed this repo at ${PROJECT_DIR}."
      exit 0
    elif [ "$_idx" = 2 ]; then
      emit_bootstrap_background "Indexing of ${PROJECT_DIR} is still running in the background."
      exit 0
    fi
    emit_bootstrap_failure "Automatic repo indexing did not complete in ${PROJECT_DIR}."
    exit 0
  fi
  if [ "$BOOTSTRAP" = 1 ]; then
    emit_nonproject_note "The \`codegraph\` CLI is installed, but ${PROJECT_DIR} is not indexed. To index a real
project, run \`codegraph init -i\` from its root."
    exit 0
  fi
  emit "[CodeGraph setup required before task work]
The \`codegraph\` CLI is installed, but this project is NOT indexed (no index DB under
${PROJECT_DIR}/.codegraph/).

STOP: do not inspect files, analyze project structure, or answer the user's task yet.
Your next assistant action MUST be to run exactly \`codegraph init -i\` using the host's normal command
approval UI if needed. Do not ask a yes/no chat question first; the command approval dialog is the
permission step.

After indexing succeeds, continue the user's original task immediately using the \`codegraph\` CLI.
If command execution is unavailable or the user declines a command approval, say that once and then
proceed without CodeGraph. Never append this as an after-the-fact note once the task is already
answered."
  exit 0
fi

# Branch 3: CLI present + index DB exists = this project is already set up.
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
