#!/usr/bin/env bash
# install.sh — wire the CodeGraph session-startup rule + hook into AI coding agents.
#
# Places codegraph-session-check.sh + codegraph-policy.md, writes each agent's
# policy/instruction file, and registers a session-start hook where the agent
# supports one. Idempotent. Never clobbers an existing config: it merges via
# python3 when available, otherwise prints the exact snippet to add by hand.
#
# Usage:
#   ./install.sh --project [DIR]     wire into a project (default: current dir)
#   ./install.sh --global            wire into your user-level (~/) configs — applies to ALL projects
#   ./install.sh ... --agents a,b    only these agents (default: all)
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

SCOPE=""
TARGET=""
AGENTS="claude,codex,cursor,gemini,opencode,antigravity,kimi,qoder"
DRYRUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project) SCOPE="project"; if [ "${2:-}" ] && [ "${2#-}" = "$2" ]; then TARGET="$2"; shift; fi; shift ;;
    --global) SCOPE="global"; shift ;;
    --agents) AGENTS="${2:-$AGENTS}"; shift 2 ;;
    --agents=*) AGENTS="${1#*=}"; shift ;;
    --dry-run) DRYRUN=1; shift ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -z "$SCOPE" ] && { echo "error: pass --project [DIR] or --global" >&2; exit 2; }
[ -f "$SCRIPT_SRC" ] || { echo "error: $SCRIPT_SRC not found" >&2; exit 2; }
[ -f "$POLICY_SRC" ] || { echo "error: $POLICY_SRC not found" >&2; exit 2; }

if [ "$SCOPE" = "project" ]; then
  TARGET="${TARGET:-$PWD}"
  TARGET="$(cd "$TARGET" 2>/dev/null && pwd || echo "$TARGET")"
  KIT_DEST="$TARGET/tools/codegraph-bootstrap"
  # Committed configs use a project-relative script path so they work on any machine.
  SCRIPT_REL="tools/codegraph-bootstrap/codegraph-session-check.sh"
  SCRIPT_CLAUDE="\$CLAUDE_PROJECT_DIR/$SCRIPT_REL"
  SCRIPT_OTHER="$SCRIPT_REL"
  ROOT="$TARGET"
else
  KIT_DEST="$HOME/.codegraph"
  SCRIPT_CLAUDE="$HOME/.codegraph/codegraph-session-check.sh"
  SCRIPT_OTHER="$HOME/.codegraph/codegraph-session-check.sh"
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

note() { printf '[codegraph-bootstrap] %s\n' "$*"; }

putfile() { # putfile DEST < content
  local dest="$1"; local dir; dir="$(dirname "$dest")"
  mkdir -p "$dir" 2>/dev/null
  if [ "$DRYRUN" = 1 ]; then note "would write $dest"; cat >/dev/null; return; fi
  cat > "$dest"; note "wrote $dest"
}

# Insert/replace a marker-delimited block in a shared markdown file (idempotent).
append_marked() { # append_marked FILE
  local file="$1"
  if [ "$DRYRUN" = 1 ]; then note "would update policy block in $file"; return; fi
  if [ "$HAVE_PY" = 1 ]; then
    CG_FILE="$file" CG_POLICY="$POLICY_SRC" "$PY" - <<'PY'
import os, re
f=os.environ["CG_FILE"]; policy=open(os.environ["CG_POLICY"]).read().rstrip()+"\n"
s="<!-- codegraph-session-startup:start -->"; e="<!-- codegraph-session-startup:end -->"
block=f"{s}\n{policy}{e}\n"
try: txt=open(f).read()
except FileNotFoundError: txt=""
if s in txt and e in txt:
    txt=re.sub(re.escape(s)+r".*?"+re.escape(e)+r"\n?", block, txt, flags=re.S)
else:
    if txt and not txt.endswith("\n"): txt+="\n"
    txt += ("\n" if txt else "") + block
open(f,"w").write(txt)
PY
    note "updated policy block in $file"
  else
    if grep -q "codegraph-session-startup:start" "$file" 2>/dev/null; then
      note "policy block already present in $file (no python3 to refresh) — skipping"
    else
      { printf '\n<!-- codegraph-session-startup:start -->\n'; cat "$POLICY_SRC"; printf '\n<!-- codegraph-session-startup:end -->\n'; } >> "$file"
      note "appended policy block to $file"
    fi
  fi
}

# Merge a session-start command hook into a JSON config (idempotent). Falls back
# to printing the snippet when python3 is unavailable.
json_hook() { # json_hook FILE KIND CMD
  local file="$1" kind="$2" cmd="$3"
  if [ "$DRYRUN" = 1 ]; then note "would register $kind SessionStart hook in $file"; return; fi
  if [ "$HAVE_PY" = 1 ]; then
    mkdir -p "$(dirname "$file")" 2>/dev/null
    CG_FILE="$file" CG_KIND="$kind" CG_CMD="$cmd" "$PY" - <<'PY'
import os, json
f=os.environ["CG_FILE"]; kind=os.environ["CG_KIND"]; cmd=os.environ["CG_CMD"]
try:
    data=json.load(open(f))
    if not isinstance(data, dict): data={}
except Exception:
    data={}
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
json.dump(data, open(f,"w"), indent=2); open(f,"a").write("\n")
PY
    note "registered $kind SessionStart hook in $file"
  else
    note "python3 not found — add this to $file manually:"
    printf '    SessionStart command hook -> %s\n' "$cmd"
  fi
}

with_policy_frontmatter() { # with_policy_frontmatter "<frontmatter>"  (emits frontmatter+policy to stdout)
  printf '%s\n' "$1"; cat "$POLICY_SRC"
}

selected() { case ",$AGENTS," in *",$1,"*) return 0 ;; *) return 1 ;; esac }

# --- place the kit -------------------------------------------------------------
note "scope=$SCOPE target=$ROOT  agents=$AGENTS  dry-run=$DRYRUN"
if [ "$DRYRUN" = 0 ]; then
  mkdir -p "$KIT_DEST"
  cp "$SCRIPT_SRC" "$KIT_DEST/codegraph-session-check.sh"; chmod +x "$KIT_DEST/codegraph-session-check.sh"
  cp "$POLICY_SRC" "$KIT_DEST/codegraph-policy.md"
  note "placed kit in $KIT_DEST"
else
  note "would place kit in $KIT_DEST"
fi

# --- per-agent wiring ----------------------------------------------------------

if selected claude; then
  if [ "$SCOPE" = "project" ]; then SETTINGS="$ROOT/.claude/settings.json"; else SETTINGS="$HOME/.claude/settings.json"; fi
  if [ "$CLAUDE_RULE_MODE" = "append" ]; then append_marked "$CLAUDE_RULE"   # global: ~/.claude/CLAUDE.md (auto-loaded)
  else cat "$POLICY_SRC" | putfile "$CLAUDE_RULE"; fi                        # project: .claude/rules/*.md
  json_hook "$SETTINGS" claude "bash \"$SCRIPT_CLAUDE\" --format json"
fi

if selected codex; then
  append_marked "$CODEX_INSTR"
  if [ "$SCOPE" = "project" ]; then CFILE="$ROOT/.codex/hooks.json"; else CFILE="$HOME/.codex/hooks.json"; fi
  json_hook "$CFILE" codex "bash \"$SCRIPT_OTHER\" --format text"
fi

if selected cursor; then
  if [ "$SCOPE" = "project" ]; then HFILE="$ROOT/.cursor/hooks.json"; else HFILE="$HOME/.cursor/hooks.json"; fi
  if [ -n "$CURSOR_MDC" ]; then
    with_policy_frontmatter "---
description: CodeGraph session-startup rule — verify install/index/freshness before work
alwaysApply: true
---" | putfile "$CURSOR_MDC"
  else
    note "Cursor global rules are UI-only (User Rules); the global hook covers Cursor. Add the rule via Cursor Settings > Rules if you want the doc."
  fi
  json_hook "$HFILE" cursor "bash \"$SCRIPT_OTHER\" --format cursor"
fi

if selected gemini; then
  append_marked "$GEMINI_INSTR"
  if [ "$SCOPE" = "project" ]; then GS="$ROOT/.gemini/settings.json"; else GS="$HOME/.gemini/settings.json"; fi
  json_hook "$GS" gemini "bash \"$SCRIPT_OTHER\" --format json"
  # Make Gemini also read AGENTS.md (so the shared policy applies).
  if [ "$HAVE_PY" = 1 ] && [ "$DRYRUN" = 0 ]; then
    CG_FILE="$GS" "$PY" - <<'PY'
import os, json
f=os.environ["CG_FILE"]
try: data=json.load(open(f))
except Exception: data={}
ctx=data.setdefault("context", {})
names=ctx.get("fileName")
want=["AGENTS.md","GEMINI.md"]
if isinstance(names, str): names=[names]
if not isinstance(names, list): names=[]
for w in want:
    if w not in names: names.append(w)
ctx["fileName"]=names
json.dump(data, open(f,"w"), indent=2); open(f,"a").write("\n")
PY
    note "set context.fileName=[AGENTS.md,GEMINI.md] in $GS"
  fi
fi

if selected opencode; then
  if [ "$SCOPE" = "project" ]; then PLUG="$ROOT/.opencode/plugins/codegraph-session-check.js"; SREF="$SCRIPT_OTHER"
  else PLUG="$HOME/.config/opencode/plugins/codegraph-session-check.js"; SREF="$SCRIPT_OTHER"; fi
  putfile "$PLUG" <<JS
// CodeGraph session-startup hook for opencode. Runs codegraph-session-check.sh
// on session.created and surfaces the result. opencode also reads AGENTS.md.
export const CodegraphSessionCheck = async ({ \$, directory }) => ({
  "session.created": async () => {
    try {
      const out = await \$\`bash ${SREF} --format text --project \${directory}\`.quiet().nothrow();
      const text = (out.stdout || "").toString().trim();
      if (text) console.log(text);
    } catch (_) { /* never block session start */ }
  },
});
JS
  # opencode reads AGENTS.md natively — ensure the shared policy is there.
  append_marked "$OPENCODE_INSTR"
fi

if selected antigravity; then
  [ -n "$ANTI_RULE" ] && cat "$POLICY_SRC" | putfile "$ANTI_RULE"   # project: .agents/rules/*.md
  append_marked "$ANTI_INSTR"                                       # global: ~/.gemini/GEMINI.md (shared)
  if [ "$SCOPE" = "project" ]; then AH="$ROOT/.agents/hooks.json"; else AH="$HOME/.gemini/antigravity-cli/plugins/codegraph/hooks.json"; fi
  json_hook "$AH" antigravity "bash \"$SCRIPT_OTHER\" --format text"
fi

if selected kimi; then
  if [ "$SCOPE" = "project" ]; then SKILL="$ROOT/.kimi-code/skills/codegraph-startup/SKILL.md"; else SKILL="$HOME/.kimi-code/skills/codegraph-startup/SKILL.md"; fi
  with_policy_frontmatter "---
name: codegraph-startup
description: At session start, verify CodeGraph is installed, indexed, and fresh before substantive work.
whenToUse: At the very start of every session, before doing substantive work on a task.
---" | putfile "$SKILL"
  # Kimi supports hooks ONLY in the global ~/.kimi-code/config.toml — so the hook is
  # written on --global only. A --project install writes the skill and prints the snippet,
  # never silently mutating your global config.
  KCONF="$HOME/.kimi-code/config.toml"
  KCMD="bash $SCRIPT_OTHER --format text"
  if [ "$SCOPE" = "global" ]; then
    if [ "$DRYRUN" = 1 ]; then note "would append Kimi SessionStart hook to $KCONF"
    elif grep -q "codegraph-session-check.sh" "$KCONF" 2>/dev/null; then note "Kimi SessionStart hook already in $KCONF"
    else
      mkdir -p "$(dirname "$KCONF")" 2>/dev/null
      printf '\n# codegraph-session-startup\n[[hooks]]\nevent = "SessionStart"\ncommand = "%s"\ntimeout = 10\n' "$KCMD" >> "$KCONF"
      note "appended Kimi SessionStart hook to $KCONF (global)"
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
  else
    note "Qoder has no SessionStart hook and no documented global rules dir — wire Qoder per-project (install.sh --project)."
  fi
fi

note "done."
[ "$SCOPE" = "project" ] && note "Restart your agent/IDE so MCP + hooks load. CLI works immediately via Bash."
exit 0
