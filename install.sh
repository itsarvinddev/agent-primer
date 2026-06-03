#!/usr/bin/env bash
# install.sh — wire the CodeGraph session-startup rule (+ hook), the Karpathy coding
# guidelines, and the Superpowers methodology + plugin-bootstrap into AI coding agents.
#
# Places codegraph-session-check.sh + the policy docs (codegraph-policy.md,
# karpathy-policy.md, superpowers-policy.md), writes each agent's policy/instruction
# file(s), and registers a session-start hook where the agent supports one (only the
# CodeGraph rule has a hook; Karpathy + Superpowers are policy-only). Idempotent. Never clobbers an existing config: it merges via
# python3 when available, otherwise prints the exact snippet to add by hand.
#
# Usage:
#   ./install.sh --project [DIR]     wire into a project (default: current dir)
#   ./install.sh --global            wire into your user-level (~/) configs — applies to ALL projects
#   ./install.sh ... --agents a,b    only these agents (default: all)
#   ./install.sh ... --with a,b      also install opt-in bundles (mcp, tools, rules, skills, agent-extensions; or 'all')
#   ./install.sh ... --dry-run       show what would happen, write nothing
#
# Agents: claude, codex, cursor, gemini, opencode, antigravity, kimi, qoder
#
# Requires: bash, python3 (for safe JSON/TOML merges; without it, hooks for
# pre-existing config files are printed as snippets instead of merged).

set -u

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_SRC="$SELF_DIR/codegraph-session-check.sh"
POLICY_SRC="$SELF_DIR/codegraph-policy.md"
KARPATHY_SRC="$SELF_DIR/karpathy-policy.md"
SUPERPOWERS_SRC="$SELF_DIR/superpowers-policy.md"
MCP_SRC="$SELF_DIR/mcp-policy.md"
TOOLS_SRC="$SELF_DIR/tools-policy.md"
RULES_SRC="$SELF_DIR/rules-policy.md"
SKILLS_SRC="$SELF_DIR/skills-policy.md"
EXT_SRC="$SELF_DIR/agent-extensions-policy.md"
PRIMER_SRC="$SELF_DIR/primer-policy.md"           # --with primer: the primer coding-style engine (see primer/)

VERSION="0.1.0"
SCOPE=""
TARGET=""
AGENTS="claude,codex,cursor,gemini,opencode,antigravity,kimi,qoder"
KNOWN_AGENTS="claude codex cursor gemini opencode antigravity kimi qoder"
WITH=""                                   # opt-in extra bundles (comma list); the core 3 always install
KNOWN_BUNDLES="mcp tools rules skills agent-extensions"
KNOWN_SOLO="primer"               # opt-in (needs Node); NEVER part of `--with all`
DRYRUN=0
ALWAYS=0   # 1 => thread --always into every wired hook command (legacy every-session mode)
FAILED=0   # set to 1 by any failed write/merge; controls the final exit code

usage() {
  cat <<'EOF'
agent-primer — wire the CodeGraph rule (+ hook), the Karpathy guidelines, and the
Superpowers methodology/plugin-bootstrap into AI coding agents.

Usage:
  install.sh --project [DIR]     wire into a project (default: current dir)
  install.sh --global            wire into your user-level (~/) configs — applies to ALL projects
  install.sh ... --agents a,b    only these agents (comma-separated; default: all)
  install.sh ... --dry-run       show what would happen, write nothing
  install.sh ... --always        wire every-session hooks (default: once per project — quiet after setup)
  install.sh ... --with a,b      also install opt-in bundles: mcp, tools, rules, skills, agent-extensions (or 'all')
  install.sh ... --with primer   wire the local coding-style engine (Node>=22.5; not in 'all')
  install.sh --version           print version and exit
  install.sh -h | --help         show this help

Agents: claude, codex, cursor, gemini, opencode, antigravity, kimi, qoder
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project) SCOPE="project"; if [ "${2:-}" ] && [ "${2#-}" = "$2" ]; then TARGET="$2"; shift; fi; shift ;;
    --global) SCOPE="global"; shift ;;
    # NOTE: `shift 2` fails (and shifts nothing → infinite loop) on bash 3.2 when the
    # flag is the last arg; do a guarded double-shift instead.
    --agents) AGENTS="${2:-}"; shift; [ "$#" -gt 0 ] && shift ;;
    --agents=*) AGENTS="${1#*=}"; shift ;;
    --dry-run) DRYRUN=1; shift ;;
    --always) ALWAYS=1; shift ;;
    --with) WITH="${2:-}"; shift; [ "$#" -gt 0 ] && shift ;;
    --with=*) WITH="${1#*=}"; shift ;;
    --version) echo "agent-primer $VERSION"; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -z "$SCOPE" ] && { echo "error: pass --project [DIR] or --global" >&2; usage >&2; exit 2; }

# Normalize whitespace and validate --agents, so a typo/spaced list fails loudly
# instead of silently installing nothing.
AGENTS="$(printf '%s' "$AGENTS" | tr -d '[:space:]')"
[ -z "$AGENTS" ] && { echo "error: --agents is empty" >&2; exit 2; }
_bad=""; _oldifs="$IFS"; IFS=','
for _a in $AGENTS; do case " $KNOWN_AGENTS " in *" $_a "*) ;; *) _bad="$_bad $_a" ;; esac; done
IFS="$_oldifs"
[ -n "$_bad" ] && { echo "error: unknown agent(s):$_bad" >&2; echo "known agents: $KNOWN_AGENTS" >&2; exit 2; }

# Opt-in bundles (--with): default install = the core 3 policies; --with adds extras; --with all = every bundle.
WITH="$(printf '%s' "$WITH" | tr -d '[:space:]')"
[ "$WITH" = "all" ] && WITH="$(printf '%s' "$KNOWN_BUNDLES" | tr ' ' ',')"
policy_on() { case ",$WITH," in *",$1,"*) return 0 ;; *) return 1 ;; esac }
if [ -n "$WITH" ]; then
  _badb=""; _oldifs="$IFS"; IFS=','
  for _b in $WITH; do case " $KNOWN_BUNDLES $KNOWN_SOLO " in *" $_b "*) ;; *) _badb="$_badb $_b" ;; esac; done
  IFS="$_oldifs"
  [ -n "$_badb" ] && { echo "error: unknown bundle(s):$_badb" >&2; echo "known bundles: $KNOWN_BUNDLES (or 'all'); solo (not in all): $KNOWN_SOLO" >&2; exit 2; }
fi

[ -f "$SCRIPT_SRC" ] || { echo "error: $SCRIPT_SRC not found" >&2; exit 2; }
[ -f "$POLICY_SRC" ] || { echo "error: $POLICY_SRC not found" >&2; exit 2; }
[ -f "$KARPATHY_SRC" ] || { echo "error: $KARPATHY_SRC not found" >&2; exit 2; }
[ -f "$SUPERPOWERS_SRC" ] || { echo "error: $SUPERPOWERS_SRC not found" >&2; exit 2; }
policy_on mcp              && { [ -f "$MCP_SRC" ]   || { echo "error: $MCP_SRC not found" >&2; exit 2; }; }
policy_on tools            && { [ -f "$TOOLS_SRC" ] || { echo "error: $TOOLS_SRC not found" >&2; exit 2; }; }
policy_on rules            && { [ -f "$RULES_SRC" ] || { echo "error: $RULES_SRC not found" >&2; exit 2; }; }
policy_on skills           && { [ -f "$SKILLS_SRC" ] || { echo "error: $SKILLS_SRC not found" >&2; exit 2; }; }
policy_on agent-extensions && { [ -f "$EXT_SRC" ]   || { echo "error: $EXT_SRC not found" >&2; exit 2; }; }

if [ "$SCOPE" = "project" ]; then
  TARGET="${TARGET:-$PWD}"
  TARGET="$(cd "$TARGET" 2>/dev/null && pwd || echo "$TARGET")"
  KIT_DEST="$TARGET/tools/agent-primer"
  # Committed configs use a project-relative script path so they work on any machine.
  SCRIPT_REL="tools/agent-primer/codegraph-session-check.sh"
  SCRIPT_CLAUDE="\$CLAUDE_PROJECT_DIR/$SCRIPT_REL"
  SCRIPT_OTHER="$SCRIPT_REL"
  ROOT="$TARGET"
else
  KIT_DEST="$HOME/.agent-primer"
  SCRIPT_CLAUDE="$HOME/.agent-primer/codegraph-session-check.sh"
  SCRIPT_OTHER="$HOME/.agent-primer/codegraph-session-check.sh"
  ROOT="$HOME"
fi

# Scope-aware instruction-doc targets. Hooks always land in each agent's own config
# dir (set in the branches below); only these instruction files differ by scope. In
# --global mode they go to each agent's real global home, not the user's home root.
if [ "$SCOPE" = "project" ]; then
  CLAUDE_RULE="$ROOT/.claude/rules/codegraph-session-startup.md"; CLAUDE_RULE_MODE="file"
  CODEX_INSTR="$ROOT/AGENTS.md"
  OPENCODE_INSTR="$ROOT/AGENTS.md"
  GEMINI_INSTR="$ROOT/GEMINI.md"
  ANTI_INSTR="$ROOT/AGENTS.md"; ANTI_RULE="$ROOT/.agents/rules/codegraph-session-startup.md"
  QODER_RULE="$ROOT/.qoder/rules/codegraph-session-startup.md"; QODER_INSTR="$ROOT/AGENTS.md"
  CURSOR_MDC="$ROOT/.cursor/rules/codegraph-session-startup.mdc"
else
  CLAUDE_RULE="$HOME/.claude/CLAUDE.md"; CLAUDE_RULE_MODE="append"
  CODEX_INSTR="$HOME/.codex/AGENTS.md"
  OPENCODE_INSTR="$HOME/.config/opencode/AGENTS.md"
  GEMINI_INSTR="$HOME/.gemini/GEMINI.md"
  ANTI_INSTR="$HOME/.gemini/GEMINI.md"; ANTI_RULE=""
  QODER_RULE=""; QODER_INSTR=""
  CURSOR_MDC=""
fi

PY="$(command -v python3 || true)"
HAVE_PY=0; [ -n "$PY" ] && HAVE_PY=1

note() { printf '[agent-primer] %s\n' "$*"; }

# JSON-encode a string to a safe double-quoted literal (for embedding a path into
# generated JS/JSON). Uses python3 when available; falls back to escaping \ and ".
json_str() { # json_str VALUE  ->  "..."
  if [ "$HAVE_PY" = 1 ]; then CG_V="$1" "$PY" -c 'import os,json;print(json.dumps(os.environ["CG_V"]))'
  else printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; fi
}

# Escape a value for a TOML basic string (backslash, then double-quote).
toml_esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

putfile() { # putfile DEST < content  (sets FAILED on error; never claims success it didn't achieve)
  local dest="$1"; local dir; dir="$(dirname "$dest")"
  if [ "$DRYRUN" = 1 ]; then note "would write $dest"; cat >/dev/null; return 0; fi
  if ! mkdir -p "$dir" 2>/dev/null; then FAILED=1; note "ERROR: cannot create $dir"; cat >/dev/null; return 1; fi
  if cat > "$dest"; then note "wrote $dest"; else FAILED=1; note "ERROR: failed to write $dest"; return 1; fi
}

# Insert/replace a marker-delimited block in a shared markdown file (idempotent).
# Defaults to the CodeGraph policy + its marker; pass a policy file and marker id to
# place a different policy block (e.g. the Karpathy guidelines) into the same file.
append_marked() { # append_marked FILE [POLICY_FILE] [MARKER_ID]
  local file="$1"; local policy="${2:-$POLICY_SRC}"; local marker="${3:-codegraph-session-startup}"
  if [ "$DRYRUN" = 1 ]; then note "would update $marker block in $file"; return 0; fi
  mkdir -p "$(dirname "$file")" 2>/dev/null   # ensure the agent's dir exists on a pristine HOME
  if [ "$HAVE_PY" = 1 ]; then
    if CG_FILE="$file" CG_POLICY="$policy" CG_MARKER="$marker" "$PY" - <<'PY'
import os, re, sys, tempfile
f=os.environ["CG_FILE"]; policy=open(os.environ["CG_POLICY"],encoding="utf-8").read().rstrip()+"\n"
m=os.environ["CG_MARKER"]; s=f"<!-- {m}:start -->"; e=f"<!-- {m}:end -->"
block=f"{s}\n{policy}{e}\n"
try: txt=open(f,encoding="utf-8").read()
except FileNotFoundError: txt=""
if s in txt and e in txt:
    txt=re.sub(re.escape(s)+r".*?"+re.escape(e)+r"\n?", block, txt, flags=re.S)
else:
    if s in txt or e in txt:   # tolerate a corrupted half-block: drop the lone marker, then re-add cleanly
        sys.stderr.write(f"[agent-primer] {f}: found a lone {m} marker; rewriting it cleanly\n")
        txt=txt.replace(s,"").replace(e,"")
    if txt and not txt.endswith("\n"): txt+="\n"
    txt += ("\n" if txt else "") + block
d=os.path.dirname(f) or "."
fd,tmp=tempfile.mkstemp(dir=d, prefix=".ap-", suffix=".tmp")
try:
    with os.fdopen(fd,"w",encoding="utf-8") as out: out.write(txt)
    os.replace(tmp,f)            # atomic: never leaves a half-written file
except Exception as ex:
    try: os.unlink(tmp)
    except OSError: pass
    sys.stderr.write(f"[agent-primer] {f}: write failed ({ex})\n"); sys.exit(1)
PY
    then note "updated $marker block in $file"
    else FAILED=1; note "ERROR: failed to update $marker block in $file"; fi
  else
    if grep -q "$marker:start" "$file" 2>/dev/null; then
      note "$marker block already present in $file (no python3 to refresh) — skipping"
    elif { printf '\n<!-- %s:start -->\n' "$marker"; cat "$policy"; printf '\n<!-- %s:end -->\n' "$marker"; } >> "$file"; then
      note "appended $marker block to $file"
    else FAILED=1; note "ERROR: failed to append $marker block to $file"; fi
  fi
}

# Merge a session-start command hook into a JSON config (idempotent). Falls back
# to printing the snippet when python3 is unavailable.
json_hook() { # json_hook FILE KIND CMD  (idempotent; refuses to clobber malformed JSON; atomic write)
  local file="$1" kind="$2" cmd="$3"
  if [ "$DRYRUN" = 1 ]; then note "would register $kind SessionStart hook in $file"; return 0; fi
  if [ "$HAVE_PY" = 1 ]; then
    mkdir -p "$(dirname "$file")" 2>/dev/null
    if CG_FILE="$file" CG_KIND="$kind" CG_CMD="$cmd" "$PY" - <<'PY'
import os, json, sys, tempfile
f=os.environ["CG_FILE"]; kind=os.environ["CG_KIND"]; cmd=os.environ["CG_CMD"]
raw=open(f,encoding="utf-8").read() if os.path.exists(f) else ""
data={}
if raw.strip():
    try:
        data=json.loads(raw)
    except Exception as ex:
        # Do NOT treat unparseable as empty — that would wipe the user's real config.
        sys.stderr.write(f"[agent-primer] {f}: existing file is not valid JSON ({ex}); refusing to modify it\n"); sys.exit(2)
    if not isinstance(data, dict):
        sys.stderr.write(f"[agent-primer] {f}: top-level JSON is not an object; refusing to modify it\n"); sys.exit(2)
def has(arr):
    # Idempotency: compare the actual command field values, not serialized JSON
    # (json.dumps escapes embedded quotes, which broke substring matching).
    for e in arr:
        if isinstance(e, dict):
            if e.get("command")==cmd: return True
            for h in (e.get("hooks") or []):
                if isinstance(h, dict) and h.get("command")==cmd: return True
    return False
if kind=="cursor":
    data.setdefault("version", 1)
    arr=data.setdefault("hooks", {}).setdefault("sessionStart", [])
    if not has(arr): arr.append({"command": cmd})
else:
    arr=data.setdefault("hooks", {}).setdefault("SessionStart", [])
    if not has(arr):
        if kind=="antigravity":
            arr.append({"command": cmd})
        else:
            entry={"hooks":[{"type":"command","command":cmd}]}
            if kind=="gemini": entry["matcher"]="startup"
            arr.append(entry)
    if kind=="gemini":
        data.setdefault("hooksConfig", {})["enabled"]=True
text=json.dumps(data, indent=2)+"\n"
d=os.path.dirname(f) or "."
fd,tmp=tempfile.mkstemp(dir=d, prefix=".ap-", suffix=".tmp")
try:
    with os.fdopen(fd,"w",encoding="utf-8") as out: out.write(text)
    os.replace(tmp,f)            # atomic: original stays intact until the full write succeeds
except Exception as ex:
    try: os.unlink(tmp)
    except OSError: pass
    sys.stderr.write(f"[agent-primer] {f}: write failed ({ex})\n"); sys.exit(3)
PY
    then note "registered $kind SessionStart hook in $file"
    else FAILED=1; note "could not merge into $file (left untouched) — add this hook manually:"; printf '    %s SessionStart -> %s\n' "$kind" "$cmd"; fi
  else
    note "python3 not found — add this to $file manually:"
    printf '    SessionStart command hook -> %s\n' "$cmd"
  fi
}

with_policy_frontmatter() { # with_policy_frontmatter "<frontmatter>" [POLICY_FILE]  (emits frontmatter+policy to stdout)
  printf '%s\n' "$1"; cat "${2:-$POLICY_SRC}"
}

# --- primer helpers ---------------------------------------------
# Merge a PostToolUse command hook into a JSON config (Claude). STRICTLY ADDITIVE to
# hooks.PostToolUse — never touches SessionStart. Idempotent; refuses malformed JSON; atomic.
json_posttooluse() { # json_posttooluse FILE CMD MATCHER
  local file="$1" cmd="$2" matcher="$3"
  if [ "$DRYRUN" = 1 ]; then note "would register PostToolUse capture hook in $file"; return 0; fi
  [ "$HAVE_PY" = 1 ] || { note "python3 not found — add a PostToolUse hook to $file manually: $cmd"; return 0; }
  mkdir -p "$(dirname "$file")" 2>/dev/null
  if CG_FILE="$file" CG_CMD="$cmd" CG_MATCHER="$matcher" "$PY" - <<'PY'
import os, json, sys, tempfile
f=os.environ["CG_FILE"]; cmd=os.environ["CG_CMD"]; matcher=os.environ["CG_MATCHER"]
raw=open(f,encoding="utf-8").read() if os.path.exists(f) else ""
data={}
if raw.strip():
    try: data=json.loads(raw)
    except Exception as ex:
        sys.stderr.write(f"[agent-primer] {f}: not valid JSON ({ex}); refusing to modify it\n"); sys.exit(2)
    if not isinstance(data, dict): sys.exit(2)
arr=data.setdefault("hooks", {}).setdefault("PostToolUse", [])   # additive: SessionStart is never touched here
def has(a):
    for e in a:
        if isinstance(e, dict):
            for h in (e.get("hooks") or []):
                if isinstance(h, dict) and h.get("command")==cmd: return True
    return False
if not has(arr):
    arr.append({"matcher": matcher, "hooks":[{"type":"command","command":cmd}]})
text=json.dumps(data, indent=2)+"\n"
d=os.path.dirname(f) or "."
fd,tmp=tempfile.mkstemp(dir=d, prefix=".ap-", suffix=".tmp")
try:
    with os.fdopen(fd,"w",encoding="utf-8") as out: out.write(text)
    os.replace(tmp,f)
except Exception as ex:
    try: os.unlink(tmp)
    except OSError: pass
    sys.stderr.write(f"[agent-primer] {f}: write failed ({ex})\n"); sys.exit(3)
PY
  then note "registered PostToolUse capture hook in $file"
  else FAILED=1; note "could not add PostToolUse hook to $file (left untouched)"; fi
}

# Node >= 22.5 (primer needs the built-in node:sqlite).
primer_node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'var v=process.versions.node.split(".").map(Number);process.exit((v[0]>22||(v[0]===22&&v[1]>=5))?0:1)' >/dev/null 2>&1
}

# Idempotently gitignore the local style DB.
primer_gitignore() { # primer_gitignore GITIGNORE_FILE
  local gi="$1"
  if [ "$DRYRUN" = 1 ]; then note "would add .primer/ to $gi"; return 0; fi
  if [ -f "$gi" ] && grep -qE '^/?\.primer/?$' "$gi" 2>/dev/null; then return 0; fi
  if printf '\n# primer: local learned coding-style DB\n.primer/\n' >> "$gi" 2>/dev/null; then
    note "added .primer/ to $gi"
  else note "could not update $gi (add .primer/ manually)"; fi
}

selected() { case ",$AGENTS," in *",$1,"*) return 0 ;; *) return 1 ;; esac }

# Once-mode is the default. With --always, every wired hook command gets the flag so the
# check stays verbose every session. The leading space lets us append it directly inside
# the existing quoted command strings (empty => byte-identical to the default).
HOOK_FLAGS=""
[ "$ALWAYS" = 1 ] && HOOK_FLAGS=" --always"

# Opt-in policy bundles (--with). Each is a HOOKLESS markdown policy distributed into the
# same instruction channels as the core 3, via place_policy. Registry rows: id|src|marker|desc.
EXTRA_REGISTRY="
mcp|$MCP_SRC|agent-primer-mcp|MCP servers — Context7 docs, GitHub, Playwright (complements CodeGraph)
tools|$TOOLS_SRC|agent-primer-tools|Code tools — ast-grep + repomix; when to use each vs CodeGraph
rules|$RULES_SRC|agent-primer-rules|Security + 12-Factor-Agents + commit/PR hygiene guardrails
skills|$SKILLS_SRC|agent-primer-skills|Skill registries — Anthropic skills, skills.sh, VoltAgent
agent-extensions|$EXT_SRC|agent-primer-extensions|Per-agent first-party plugins/skills/tools
"

# Distribute one hookless policy doc into a single agent's channel(s), honoring scope.
# Mirrors the core per-agent placement; opt-in bundles use generic frontmatter from $desc.
place_policy() { # place_policy AGENT SRC MARKER DESC
  local agent="$1" src="$2" marker="$3" desc="$4" kdir
  case "$agent" in
    claude)
      if [ "$CLAUDE_RULE_MODE" = "append" ]; then append_marked "$CLAUDE_RULE" "$src" "$marker"
      else putfile "${CLAUDE_RULE%/*}/$marker.md" < "$src"; fi ;;
    codex)    append_marked "$CODEX_INSTR" "$src" "$marker" ;;
    opencode) append_marked "$OPENCODE_INSTR" "$src" "$marker" ;;
    gemini)   append_marked "$GEMINI_INSTR" "$src" "$marker" ;;
    cursor)
      [ -n "$CURSOR_MDC" ] && with_policy_frontmatter "---
description: $desc
alwaysApply: true
---" "$src" | putfile "${CURSOR_MDC%/*}/$marker.mdc" ;;
    antigravity)
      [ -n "$ANTI_RULE" ] && putfile "${ANTI_RULE%/*}/$marker.md" < "$src"
      append_marked "$ANTI_INSTR" "$src" "$marker" ;;
    kimi)
      if [ "$SCOPE" = "project" ]; then kdir="$ROOT/.kimi-code/skills/$marker/SKILL.md"; else kdir="$HOME/.kimi-code/skills/$marker/SKILL.md"; fi
      with_policy_frontmatter "---
name: $marker
description: $desc
whenToUse: When this bundle's tools/rules are relevant to the task.
---" "$src" | putfile "$kdir" ;;
    qoder)
      [ -n "$QODER_RULE" ] || return 0
      with_policy_frontmatter "<!-- Set this rule's mode to 'Always Apply' in Qoder. $desc -->" "$src" | putfile "${QODER_RULE%/*}/$marker.md"
      append_marked "$QODER_INSTR" "$src" "$marker" ;;
  esac
}

# --- place the kit -------------------------------------------------------------
note "scope=$SCOPE target=$ROOT  agents=$AGENTS  dry-run=$DRYRUN"
if [ "$DRYRUN" = 0 ]; then
  if mkdir -p "$KIT_DEST" \
     && cp "$SCRIPT_SRC" "$KIT_DEST/codegraph-session-check.sh" && chmod +x "$KIT_DEST/codegraph-session-check.sh" \
     && cp "$POLICY_SRC" "$KIT_DEST/codegraph-policy.md" \
     && cp "$KARPATHY_SRC" "$KIT_DEST/karpathy-policy.md" \
     && cp "$SUPERPOWERS_SRC" "$KIT_DEST/superpowers-policy.md"; then
    note "placed kit in $KIT_DEST"
  else
    FAILED=1; note "ERROR: failed to place kit in $KIT_DEST"
  fi
else
  note "would place kit in $KIT_DEST"
fi

# --- per-agent wiring ----------------------------------------------------------

if selected claude; then
  if [ "$SCOPE" = "project" ]; then SETTINGS="$ROOT/.claude/settings.json"; else SETTINGS="$HOME/.claude/settings.json"; fi
  if [ "$CLAUDE_RULE_MODE" = "append" ]; then append_marked "$CLAUDE_RULE"   # global: ~/.claude/CLAUDE.md (auto-loaded)
  else putfile "$CLAUDE_RULE" < "$POLICY_SRC"; fi                            # project: .claude/rules/*.md
  if [ "$CLAUDE_RULE_MODE" = "append" ]; then append_marked "$CLAUDE_RULE" "$KARPATHY_SRC" "karpathy-guidelines"
  else putfile "${CLAUDE_RULE%/*}/karpathy-guidelines.md" < "$KARPATHY_SRC"; fi
  if [ "$CLAUDE_RULE_MODE" = "append" ]; then append_marked "$CLAUDE_RULE" "$SUPERPOWERS_SRC" "superpowers"
  else putfile "${CLAUDE_RULE%/*}/superpowers.md" < "$SUPERPOWERS_SRC"; fi
  json_hook "$SETTINGS" claude "bash \"$SCRIPT_CLAUDE\" --format json$HOOK_FLAGS"
fi

if selected codex; then
  append_marked "$CODEX_INSTR"
  append_marked "$CODEX_INSTR" "$KARPATHY_SRC" "karpathy-guidelines"
  append_marked "$CODEX_INSTR" "$SUPERPOWERS_SRC" "superpowers"
  if [ "$SCOPE" = "project" ]; then CFILE="$ROOT/.codex/hooks.json"; else CFILE="$HOME/.codex/hooks.json"; fi
  json_hook "$CFILE" codex "bash \"$SCRIPT_OTHER\" --format text$HOOK_FLAGS"
fi

if selected cursor; then
  if [ "$SCOPE" = "project" ]; then HFILE="$ROOT/.cursor/hooks.json"; else HFILE="$HOME/.cursor/hooks.json"; fi
  if [ -n "$CURSOR_MDC" ]; then
    with_policy_frontmatter "---
description: CodeGraph session-startup rule — verify install/index/freshness before work
alwaysApply: true
---" | putfile "$CURSOR_MDC"
    with_policy_frontmatter "---
description: Karpathy coding guidelines — think before coding, simplicity first, surgical changes, goal-driven execution
alwaysApply: true
---" "$KARPATHY_SRC" | putfile "${CURSOR_MDC%/*}/karpathy-guidelines.mdc"
    with_policy_frontmatter "---
description: Superpowers — install the skills plugin + its TDD/systematic/simplicity/evidence methodology
alwaysApply: true
---" "$SUPERPOWERS_SRC" | putfile "${CURSOR_MDC%/*}/superpowers.mdc"
  else
    note "Cursor global rules are UI-only (User Rules); the global hook covers Cursor. Add the rule via Cursor Settings > Rules if you want the doc."
  fi
  json_hook "$HFILE" cursor "bash \"$SCRIPT_OTHER\" --format cursor$HOOK_FLAGS"
fi

if selected gemini; then
  append_marked "$GEMINI_INSTR"
  append_marked "$GEMINI_INSTR" "$KARPATHY_SRC" "karpathy-guidelines"
  append_marked "$GEMINI_INSTR" "$SUPERPOWERS_SRC" "superpowers"
  if [ "$SCOPE" = "project" ]; then GS="$ROOT/.gemini/settings.json"; else GS="$HOME/.gemini/settings.json"; fi
  json_hook "$GS" gemini "bash \"$SCRIPT_OTHER\" --format json$HOOK_FLAGS"
  # Make Gemini also read AGENTS.md (so the shared policy applies).
  if [ "$HAVE_PY" = 1 ] && [ "$DRYRUN" = 0 ]; then
    if CG_FILE="$GS" "$PY" - <<'PY'
import os, json, sys, tempfile
f=os.environ["CG_FILE"]
raw=open(f,encoding="utf-8").read() if os.path.exists(f) else ""
data={}
if raw.strip():
    try: data=json.loads(raw)
    except Exception as ex:
        sys.stderr.write(f"[agent-primer] {f}: invalid JSON ({ex}); refusing to modify it\n"); sys.exit(2)
    if not isinstance(data, dict): sys.exit(2)
ctx=data.setdefault("context", {})
names=ctx.get("fileName")
want=["AGENTS.md","GEMINI.md"]
if isinstance(names, str): names=[names]
if not isinstance(names, list): names=[]
for w in want:
    if w not in names: names.append(w)
ctx["fileName"]=names
text=json.dumps(data, indent=2)+"\n"
d=os.path.dirname(f) or "."
fd,tmp=tempfile.mkstemp(dir=d, prefix=".ap-", suffix=".tmp")
try:
    with os.fdopen(fd,"w",encoding="utf-8") as out: out.write(text)
    os.replace(tmp,f)
except Exception as ex:
    try: os.unlink(tmp)
    except OSError: pass
    sys.exit(3)
PY
    then note "set context.fileName=[AGENTS.md,GEMINI.md] in $GS"
    else FAILED=1; note "ERROR: failed to set context.fileName in $GS"; fi
  fi
fi

if selected opencode; then
  if [ "$SCOPE" = "project" ]; then PLUG="$ROOT/.opencode/plugins/codegraph-session-check.js"; SREF="$SCRIPT_OTHER"
  else PLUG="$HOME/.config/opencode/plugins/codegraph-session-check.js"; SREF="$SCRIPT_OTHER"; fi
  SREF_JS="$(json_str "$SREF")"   # JSON-encode the path → Bun's $ tag quotes it safely (no injection / space-safe)
  putfile "$PLUG" <<JS
// agent-primer: CodeGraph session-startup hook for opencode. Runs the check on
// session.created and surfaces the result. opencode also reads AGENTS.md.
const SCRIPT = ${SREF_JS};
export const CodegraphSessionCheck = async ({ \$, directory }) => ({
  "session.created": async () => {
    try {
      const out = await \$\`bash \${SCRIPT} --format text$HOOK_FLAGS --project \${directory}\`.quiet().nothrow();
      const text = (out.stdout || "").toString().trim();
      if (text) console.log(text);
    } catch (_) { /* never block session start */ }
  },
});
JS
  # opencode reads AGENTS.md natively — ensure the shared policies are there.
  append_marked "$OPENCODE_INSTR"
  append_marked "$OPENCODE_INSTR" "$KARPATHY_SRC" "karpathy-guidelines"
  append_marked "$OPENCODE_INSTR" "$SUPERPOWERS_SRC" "superpowers"
fi

if selected antigravity; then
  [ -n "$ANTI_RULE" ] && putfile "$ANTI_RULE" < "$POLICY_SRC"       # project: .agents/rules/*.md
  append_marked "$ANTI_INSTR"                                       # global: ~/.gemini/GEMINI.md (shared)
  [ -n "$ANTI_RULE" ] && putfile "${ANTI_RULE%/*}/karpathy-guidelines.md" < "$KARPATHY_SRC"
  append_marked "$ANTI_INSTR" "$KARPATHY_SRC" "karpathy-guidelines"
  [ -n "$ANTI_RULE" ] && putfile "${ANTI_RULE%/*}/superpowers.md" < "$SUPERPOWERS_SRC"
  append_marked "$ANTI_INSTR" "$SUPERPOWERS_SRC" "superpowers"
  if [ "$SCOPE" = "project" ]; then AH="$ROOT/.agents/hooks.json"; else AH="$HOME/.gemini/antigravity-cli/plugins/agent-primer/hooks.json"; fi
  json_hook "$AH" antigravity "bash \"$SCRIPT_OTHER\" --format text$HOOK_FLAGS"
fi

if selected kimi; then
  if [ "$SCOPE" = "project" ]; then SKILL="$ROOT/.kimi-code/skills/codegraph-startup/SKILL.md"; else SKILL="$HOME/.kimi-code/skills/codegraph-startup/SKILL.md"; fi
  with_policy_frontmatter "---
name: codegraph-startup
description: At session start, verify CodeGraph is installed, indexed, and fresh before substantive work.
whenToUse: At the very start of every session, before doing substantive work on a task.
---" | putfile "$SKILL"
  if [ "$SCOPE" = "project" ]; then KSKILL="$ROOT/.kimi-code/skills/karpathy-guidelines/SKILL.md"; else KSKILL="$HOME/.kimi-code/skills/karpathy-guidelines/SKILL.md"; fi
  with_policy_frontmatter "---
name: karpathy-guidelines
description: Reduce common LLM coding mistakes — surface assumptions, keep it simple, make surgical changes, define verifiable success criteria.
whenToUse: When writing, reviewing, or refactoring code on non-trivial tasks.
---" "$KARPATHY_SRC" | putfile "$KSKILL"
  if [ "$SCOPE" = "project" ]; then SPSKILL="$ROOT/.kimi-code/skills/superpowers/SKILL.md"; else SPSKILL="$HOME/.kimi-code/skills/superpowers/SKILL.md"; fi
  with_policy_frontmatter "---
name: superpowers
description: Install the superpowers skills plugin and follow its TDD / systematic / simplicity / evidence methodology.
whenToUse: At session start, and when planning or implementing non-trivial coding work.
---" "$SUPERPOWERS_SRC" | putfile "$SPSKILL"
  # Kimi supports hooks ONLY in the global ~/.kimi-code/config.toml — so the hook is
  # written on --global only. A --project install writes the skill and prints the snippet,
  # never silently mutating your global config.
  KCONF="$HOME/.kimi-code/config.toml"
  KCMD="bash \"$SCRIPT_OTHER\" --format text$HOOK_FLAGS"   # quote the path so the shell command survives spaces in $HOME
  if [ "$SCOPE" = "global" ]; then
    if [ "$DRYRUN" = 1 ]; then note "would append Kimi SessionStart hook to $KCONF"
    elif grep -q "codegraph-session-check.sh" "$KCONF" 2>/dev/null; then note "Kimi SessionStart hook already in $KCONF"
    else
      mkdir -p "$(dirname "$KCONF")" 2>/dev/null
      if printf '\n# codegraph-session-startup\n[[hooks]]\nevent = "SessionStart"\ncommand = "%s"\ntimeout = 10\n' "$(toml_esc "$KCMD")" >> "$KCONF"; then
        note "appended Kimi SessionStart hook to $KCONF (global)"
      else FAILED=1; note "ERROR: failed to append Kimi hook to $KCONF"; fi
    fi
  else
    note "Kimi hooks are global-only — wrote the project skill. To enable Kimi's hook, run:"
    note "  $0 --global --agents kimi   (or add a [[hooks]] SessionStart with command: $KCMD to ~/.kimi-code/config.toml)"
  fi
fi

if selected qoder; then
  # Qoder reads AGENTS.md + .qoder/rules; it has NO SessionStart event, so the rule is the carrier.
  if [ -n "$QODER_RULE" ]; then
    with_policy_frontmatter "<!-- Set this rule's mode to 'Always Apply' in Qoder. Qoder has no SessionStart hook;
     this rule is the carrier. -->" | putfile "$QODER_RULE"
    append_marked "$QODER_INSTR"
    with_policy_frontmatter "<!-- Set this rule's mode to 'Always Apply' in Qoder. Karpathy coding guidelines. -->" "$KARPATHY_SRC" | putfile "${QODER_RULE%/*}/karpathy-guidelines.md"
    append_marked "$QODER_INSTR" "$KARPATHY_SRC" "karpathy-guidelines"
    with_policy_frontmatter "<!-- Set this rule's mode to 'Always Apply' in Qoder. Superpowers methodology + plugin install. -->" "$SUPERPOWERS_SRC" | putfile "${QODER_RULE%/*}/superpowers.md"
    append_marked "$QODER_INSTR" "$SUPERPOWERS_SRC" "superpowers"
  else
    note "Qoder has no SessionStart hook and no documented global rules dir — wire Qoder per-project (install.sh --project)."
  fi
fi

# --- opt-in bundles (--with) ----------------------------------------------------
# Read the registry via a here-doc-fed `while read` (NOT `… | while read`): a here-doc
# redirect keeps the loop in the CURRENT shell, so FAILED set by place_policy/append_marked
# propagates to the exit code. Per selected bundle: copy its doc into the kit dir once, then
# distribute it into each selected agent via place_policy.
while IFS='|' read -r _bid _bsrc _bmarker _bdesc; do
  [ -n "$_bid" ] || continue
  policy_on "$_bid" || continue
  if [ "$DRYRUN" = 0 ]; then
    cp "$_bsrc" "$KIT_DEST/$(basename "$_bsrc")" 2>/dev/null || { FAILED=1; note "ERROR: failed to copy $(basename "$_bsrc") to $KIT_DEST"; }
  fi
  for _ag in claude codex cursor gemini opencode antigravity kimi qoder; do
    selected "$_ag" && place_policy "$_ag" "$_bsrc" "$_bmarker" "$_bdesc"
  done
done <<REG
$EXTRA_REGISTRY
REG

# --- primer (--with primer) --------------------------------------
# primer is the published TS/Node tool @agent-primer/primer. It's resolved fastest-first:
# an installed `primer` CLI (PATH) > a repo build (dev) > `npm i -g @agent-primer/primer`
# (so the portable installer works with no clone). Everything below is gated on
# `policy_on primer`; the default install and `--with all` never touch it, and the proven
# core wiring above stays byte-identical.
PRIMER_PKG="@agent-primer/primer"
run_primer() { # run primer however it was resolved
  case "${PRIMER_KIND:-}" in
    path) primer "$@" ;;
    repo) "$NODE_BIN" "$PRIMER_JS" "$@" ;;
    *) return 1 ;;
  esac
}
if policy_on primer; then
  note "primer (coding-style engine). Architecture + roadmap: primer/DESIGN.md"
  # primer launcher: repo layout ($SELF_DIR/primer/dist) or bundled-npm layout (kit/../dist).
  PRIMER_JS="$SELF_DIR/primer/dist/bin/primer.js"
  [ -f "$PRIMER_JS" ] || { [ -f "$SELF_DIR/../dist/bin/primer.js" ] && PRIMER_JS="$SELF_DIR/../dist/bin/primer.js"; }
  NODE_BIN="$(command -v node || true)"
  # A launcher under npx's transient cache (~/.npm/_npx/<hash>) must NOT be wired into persistent
  # agent config — npx prunes it and every hook/MCP entry would dangle. Treat it as "no stable
  # build" so we resolve a persistent primer (installed CLI, else `npm i -g`) instead.
  PRIMER_STABLE_JS=""
  case "$PRIMER_JS" in */_npx/*) : ;; *) [ -f "$PRIMER_JS" ] && PRIMER_STABLE_JS="$PRIMER_JS" ;; esac
  PRIMER_KIND=""
  if command -v primer >/dev/null 2>&1; then
    PRIMER_KIND="path"; note "primer: using installed CLI ($(command -v primer))"
  elif [ -n "$PRIMER_STABLE_JS" ]; then
    PRIMER_JS="$PRIMER_STABLE_JS"; PRIMER_KIND="repo"; note "primer: using repo build ($PRIMER_JS)"
  elif [ -d "$SELF_DIR/primer" ] && primer_node_ok && [ "$DRYRUN" = 0 ]; then
    note "primer: building from repo (npm ci && npm run build) ..."
    ( cd "$SELF_DIR/primer" && npm ci >/dev/null 2>&1 && npm run build >/dev/null 2>&1 ) && [ -f "$SELF_DIR/primer/dist/bin/primer.js" ] && { PRIMER_JS="$SELF_DIR/primer/dist/bin/primer.js"; PRIMER_KIND="repo"; }
  fi
  if [ -z "$PRIMER_KIND" ] && [ "$DRYRUN" = 0 ] && command -v npm >/dev/null 2>&1 && primer_node_ok; then
    note "primer: installing $PRIMER_PKG globally so wired paths persist (npx's cache is temporary) ..."
    npm install -g "$PRIMER_PKG" >/dev/null 2>&1 && command -v primer >/dev/null 2>&1 && { PRIMER_KIND="path"; note "primer: installed -> $(command -v primer)"; }
  fi
  case "$PRIMER_KIND" in
    path) PRIMER_INVOKE="primer" ;;
    repo) PRIMER_INVOKE="\"$NODE_BIN\" \"$PRIMER_JS\"" ;;
    *) PRIMER_INVOKE="" ;;
  esac

  if [ -z "$PRIMER_KIND" ]; then
    if [ "$DRYRUN" = 1 ]; then note "would resolve primer (installed CLI / repo build / npm i -g $PRIMER_PKG) and wire it."
    else note "primer: could not resolve a runnable primer. Install once: npm i -g $PRIMER_PKG (needs Node>=22.5), then re-run with --with primer. Ad-hoc: npx $PRIMER_PKG"; fi
  elif [ "$DRYRUN" = 1 ]; then
    note "would init the style DB, register the MCP server, distribute primer-policy.md, and wire the [Primer] brief + capture hooks via: $PRIMER_INVOKE"
  else
    # primer's MCP installer only knows these agents; honor --agents.
    PRIMER_TARGETS=""
    for _ag in claude cursor gemini codex opencode; do selected "$_ag" && PRIMER_TARGETS="$PRIMER_TARGETS,$_ag"; done
    PRIMER_TARGETS="${PRIMER_TARGETS#,}"
    # Init the style DB (scope-aware) + register the MCP server.
    if [ "$SCOPE" = "project" ]; then
      run_primer init --db "$ROOT/.primer/primer.db" >/dev/null 2>&1 || true
      [ -n "$PRIMER_TARGETS" ] && run_primer install --local --cwd "$ROOT" --target "$PRIMER_TARGETS" 2>&1 | sed 's/^/[agent-primer] /'
      primer_gitignore "$ROOT/.gitignore"
    else
      run_primer init --scope global >/dev/null 2>&1 || true
      [ -n "$PRIMER_TARGETS" ] && run_primer install --target "$PRIMER_TARGETS" 2>&1 | sed 's/^/[agent-primer] /'
    fi
    # Distribute the policy doc to every selected agent (marker: primer).
    if [ -f "$PRIMER_SRC" ]; then
      for _ag in claude codex cursor gemini opencode antigravity kimi qoder; do
        selected "$_ag" && place_policy "$_ag" "$PRIMER_SRC" "primer" "primer — apply + record your local coding style over MCP"
      done
    fi
    # The [Primer] SessionStart brief (agents whose hook format we already support) + Claude
    # PostToolUse capture. All ADDITIVE; SessionStart entries already present stay untouched.
    selected claude && { json_hook "$SETTINGS" claude "$PRIMER_INVOKE brief --format json --nudge"; json_posttooluse "$SETTINGS" "$PRIMER_INVOKE signal --stdin" "Edit|Write|MultiEdit"; }
    selected gemini      && json_hook "$GS"    gemini      "$PRIMER_INVOKE brief --format json --nudge"
    selected cursor      && json_hook "$HFILE" cursor      "$PRIMER_INVOKE brief --format cursor --nudge"
    selected codex       && json_hook "$CFILE" codex       "$PRIMER_INVOKE brief --format text --nudge"
    selected antigravity && json_hook "$AH"    antigravity "$PRIMER_INVOKE brief --format text --nudge"
    # opencode uses a .js plugin (not JSON hooks): emit the [Primer] brief on session.created.
    if selected opencode; then
      if [ "$SCOPE" = "project" ]; then PPLUG="$ROOT/.opencode/plugins/primer-session-check.js"; else PPLUG="$HOME/.config/opencode/plugins/primer-session-check.js"; fi
      putfile "$PPLUG" <<JS
// agent-primer: primer [Primer] style brief for opencode (emitted on session.created).
export const PrimerSessionCheck = async ({ \$ }) => ({
  "session.created": async () => {
    try {
      const out = await \$\`$PRIMER_INVOKE brief --format text --nudge\`.quiet().nothrow();
      const text = (out.stdout || "").toString().trim();
      if (text) console.log(text);
    } catch (_) { /* never block session start */ }
  },
});
JS
    fi
    # kimi hooks are global-only: add a SECOND SessionStart [[hooks]] for the primer brief.
    if selected kimi && [ "$SCOPE" = "global" ]; then
      KCONF="$HOME/.kimi-code/config.toml"; mkdir -p "$(dirname "$KCONF")" 2>/dev/null
      if grep -q "brief --format text" "$KCONF" 2>/dev/null; then note "Kimi primer brief already in $KCONF"
      elif printf '\n# primer brief\n[[hooks]]\nevent = "SessionStart"\ncommand = "%s"\ntimeout = 10\n' "$(toml_esc "$PRIMER_INVOKE brief --format text --nudge")" >> "$KCONF"; then note "appended Kimi primer brief to $KCONF (global)"
      else note "could not append Kimi primer brief to $KCONF"; fi
      # Kimi PostToolUse capture (payload arrives on stdin, like Claude).
      if ! grep -q "signal --stdin" "$KCONF" 2>/dev/null; then
        printf '\n# primer capture\n[[hooks]]\nevent = "PostToolUse"\nmatcher = "WriteFile|StrReplaceFile"\ncommand = "%s"\ntimeout = 10\n' "$(toml_esc "$PRIMER_INVOKE signal --stdin")" >> "$KCONF" && note "appended Kimi primer capture to $KCONF (global)"
      fi
    elif selected kimi; then
      note "primer: Kimi hooks are global-only — the [Primer] brief + capture need --global (Kimi still gets the policy)."
    fi
    note "primer: wired ($SCOPE, via $PRIMER_KIND). RESTART your agent so the primer_* MCP tools load (the [Primer] brief works now)."
    note "primer: brief -> claude/cursor/gemini/codex/antigravity/opencode (Kimi on --global; Qoder=policy). Edit-capture -> Claude + Kimi (--global); opencode capture is a follow-up."
  fi
fi

if [ "$FAILED" = 0 ]; then note "done."; else note "done — but some writes FAILED (see ERROR lines above)."; fi
[ "$SCOPE" = "project" ] && note "Restart your agent/IDE so MCP + hooks load. CLI works immediately via Bash."
exit "$FAILED"
