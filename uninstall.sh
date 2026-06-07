#!/usr/bin/env bash
# uninstall.sh — cleanly reverse what install.sh wired into your AI coding agents:
# the marker-delimited policy blocks, the SessionStart hook entries, the standalone
# rule/skill files, the opencode plugin, and the kit dir. Mirrors install.sh's flags.
#
# Idempotent and safe to run when nothing is installed. Refuses to touch a config it
# can't parse; writes atomically (temp file + rename) so it never half-writes a file.
#
# Usage:
#   ./uninstall.sh --project [DIR]   remove from a project (default: current dir)
#   ./uninstall.sh --global          remove from your user-level (~/) configs
#   ./uninstall.sh ... --agents a,b  only these agents (comma-separated; default: all)
#   ./uninstall.sh ... --dry-run     show what would happen, change nothing
#   ./uninstall.sh --version
#   ./uninstall.sh -h | --help

set -u

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
PRIMER_JS="$SELF_DIR/primer/dist/bin/primer.js"   # primer launcher (repo layout)
[ -f "$PRIMER_JS" ] || { [ -f "$SELF_DIR/../dist/bin/primer.js" ] && PRIMER_JS="$SELF_DIR/../dist/bin/primer.js"; }   # bundled-npm layout
VERSION="0.1.0"
SCOPE=""
TARGET=""
AGENTS="claude,codex,cursor,gemini,opencode,antigravity,kimi,qoder"
KNOWN_AGENTS="claude codex cursor gemini opencode antigravity kimi qoder"
DRYRUN=0
PURGE=0    # --purge also deletes the learned primer style DB (.primer/); default PRESERVES it
FAILED=0
MARKERS="codegraph-session-startup karpathy-guidelines superpowers agent-primer-mcp agent-primer-tools agent-primer-rules agent-primer-skills agent-primer-extensions primer"
# Standalone rule/skill basenames install.sh writes (core 3 + opt-in bundles). One list, used by
# every per-agent removal loop (was duplicated 5×). Kimi's codegraph skill dir is the lone exception.
STANDALONE_NAMES="codegraph-session-startup karpathy-guidelines superpowers agent-primer-mcp agent-primer-tools agent-primer-rules agent-primer-skills agent-primer-extensions primer"
KIMI_SKILL_NAMES="codegraph-startup karpathy-guidelines superpowers agent-primer-mcp agent-primer-tools agent-primer-rules agent-primer-skills agent-primer-extensions primer"
HOOK_TAG="codegraph-session-check.sh"   # identifies the core hook entries/commands we added
PRIMER_TAG="primer.js|brief --format|signal --stdin"   # any of these identifies a primer hook (repo/global/npx forms)

usage() {
  cat <<'EOF'
agent-primer uninstaller — reverse what install.sh wired into AI coding agents.

Usage:
  uninstall.sh --project [DIR]     remove from a project (default: current dir)
  uninstall.sh --global            remove from your user-level (~/) configs
  uninstall.sh ... --agents a,b    only these agents (comma-separated; default: all)
  uninstall.sh ... --dry-run       show what would happen, change nothing
  uninstall.sh ... --purge         also delete the primer style DB (.primer/); default keeps it
  uninstall.sh --version           print version and exit
  uninstall.sh -h | --help         show this help

Agents: claude, codex, cursor, gemini, opencode, antigravity, kimi, qoder
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project) SCOPE="project"; if [ "${2:-}" ] && [ "${2#-}" = "$2" ]; then TARGET="$2"; shift; fi; shift ;;
    --global) SCOPE="global"; shift ;;
    --agents) AGENTS="${2:-}"; shift; [ "$#" -gt 0 ] && shift ;;
    --agents=*) AGENTS="${1#*=}"; shift ;;
    --dry-run) DRYRUN=1; shift ;;
    --purge) PURGE=1; shift ;;
    --version) echo "agent-primer $VERSION"; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -z "$SCOPE" ] && { echo "error: pass --project [DIR] or --global" >&2; usage >&2; exit 2; }

AGENTS="$(printf '%s' "$AGENTS" | tr -d '[:space:]')"
[ -z "$AGENTS" ] && { echo "error: --agents is empty" >&2; exit 2; }
_bad=""; _oldifs="$IFS"; IFS=','
for _a in $AGENTS; do case " $KNOWN_AGENTS " in *" $_a "*) ;; *) _bad="$_bad $_a" ;; esac; done
IFS="$_oldifs"
[ -n "$_bad" ] && { echo "error: unknown agent(s):$_bad" >&2; echo "known agents: $KNOWN_AGENTS" >&2; exit 2; }

# Scope-aware paths — MUST match install.sh exactly so we remove what it placed.
if [ "$SCOPE" = "project" ]; then
  TARGET="${TARGET:-$PWD}"
  TARGET="$(cd "$TARGET" 2>/dev/null && pwd || echo "$TARGET")"
  ROOT="$TARGET"
  KIT_DEST="$TARGET/tools/agent-primer"
  CLAUDE_RULE_DIR="$ROOT/.claude/rules"; CLAUDE_RULE_MODE="file"
  CODEX_INSTR="$ROOT/AGENTS.md"; OPENCODE_INSTR="$ROOT/AGENTS.md"
  GEMINI_INSTR="$ROOT/GEMINI.md"
  ANTI_INSTR="$ROOT/AGENTS.md"; ANTI_RULE_DIR="$ROOT/.agents/rules"
  QODER_RULE_DIR="$ROOT/.qoder/rules"; QODER_INSTR="$ROOT/AGENTS.md"
  CURSOR_RULE_DIR="$ROOT/.cursor/rules"
  SETTINGS="$ROOT/.claude/settings.json"; CFILE="$ROOT/.codex/hooks.json"
  HFILE="$ROOT/.cursor/hooks.json"; GS="$ROOT/.gemini/settings.json"
  AH="$ROOT/.agents/hooks.json"
  OPENCODE_PLUG="$ROOT/.opencode/plugins/codegraph-session-check.js"
  KIMI_SKILLS="$ROOT/.kimi-code/skills"
else
  ROOT="$HOME"
  KIT_DEST="$HOME/.agent-primer"
  CLAUDE_RULE="$HOME/.claude/CLAUDE.md"; CLAUDE_RULE_MODE="append"
  CODEX_INSTR="$HOME/.codex/AGENTS.md"; OPENCODE_INSTR="$HOME/.config/opencode/AGENTS.md"
  GEMINI_INSTR="$HOME/.gemini/GEMINI.md"
  ANTI_INSTR="$HOME/.gemini/GEMINI.md"; ANTI_RULE_DIR=""
  QODER_RULE_DIR=""; QODER_INSTR=""
  CURSOR_RULE_DIR=""
  SETTINGS="$HOME/.claude/settings.json"; CFILE="$HOME/.codex/hooks.json"
  HFILE="$HOME/.cursor/hooks.json"; GS="$HOME/.gemini/settings.json"
  AH="$HOME/.gemini/antigravity-cli/plugins/agent-primer/hooks.json"
  OPENCODE_PLUG="$HOME/.config/opencode/plugins/codegraph-session-check.js"
  KIMI_SKILLS="$HOME/.kimi-code/skills"
  KCONF="$HOME/.kimi-code/config.toml"
fi

PY="$(command -v python3 || true)"
HAVE_PY=0; [ -n "$PY" ] && HAVE_PY=1
note() { printf '[agent-primer] %s\n' "$*"; }
selected() { case ",$AGENTS," in *",$1,"*) return 0 ;; *) return 1 ;; esac }

rm_path() { # rm_path PATH (file or dir; quiet if absent)
  local p="$1"; { [ -e "$p" ] || [ -L "$p" ]; } || return 0
  if [ "$DRYRUN" = 1 ]; then note "would remove $p"; return 0; fi
  if rm -rf "$p"; then note "removed $p"; else FAILED=1; note "ERROR: failed to remove $p"; fi
}

# Strip our marker blocks from a shared markdown file; delete the file if it ends up empty.
strip_markers() { # strip_markers FILE
  local file="$1"; [ -f "$file" ] || return 0
  if [ "$DRYRUN" = 1 ]; then note "would strip policy blocks from $file"; return 0; fi
  if [ "$HAVE_PY" = 0 ]; then note "python3 not found — remove the <!-- {marker}:start/end --> blocks from $file by hand"; return 0; fi
  if CG_FILE="$file" CG_MARKERS="$MARKERS" "$PY" - <<'PY'
import os, re, sys, tempfile
f=os.environ["CG_FILE"]; markers=os.environ["CG_MARKERS"].split()
txt=open(f,encoding="utf-8").read(); orig=txt
for m in markers:
    s=re.escape(f"<!-- {m}:start -->"); e=re.escape(f"<!-- {m}:end -->")
    txt=re.sub(r"\n*"+s+r".*?"+e+r"\n?", "\n", txt, flags=re.S)
if txt==orig: sys.exit(0)
if not txt.strip():
    try: os.remove(f)
    except OSError as ex: sys.stderr.write(f"[agent-primer] {f}: {ex}\n"); sys.exit(1)
    sys.exit(0)
d=os.path.dirname(f) or "."; fd,tmp=tempfile.mkstemp(dir=d, prefix=".ap-", suffix=".tmp")
try:
    with os.fdopen(fd,"w",encoding="utf-8") as o: o.write(txt.lstrip("\n"))
    os.replace(tmp,f)
except Exception as ex:
    try: os.unlink(tmp)
    except OSError: pass
    sys.stderr.write(f"[agent-primer] {f}: write failed ({ex})\n"); sys.exit(1)
PY
  then note "stripped policy blocks from $file"
  else FAILED=1; note "ERROR: failed to strip blocks from $file"; fi
}

# Remove our SessionStart hook entries from a JSON config (atomic; refuses malformed).
unhook_json() { # unhook_json FILE KIND
  local file="$1" kind="$2"; [ -f "$file" ] || return 0
  if [ "$DRYRUN" = 1 ]; then note "would remove hook from $file"; return 0; fi
  if [ "$HAVE_PY" = 0 ]; then note "python3 not found — remove the SessionStart entry running $HOOK_TAG from $file by hand"; return 0; fi
  if CG_FILE="$file" CG_KIND="$kind" CG_TAG="$HOOK_TAG" "$PY" - <<'PY'
import os, json, sys, tempfile
f=os.environ["CG_FILE"]; kind=os.environ["CG_KIND"]; tag=os.environ["CG_TAG"]
raw=open(f,encoding="utf-8").read()
if not raw.strip(): sys.exit(0)
try: data=json.loads(raw)
except Exception as ex:
    sys.stderr.write(f"[agent-primer] {f}: invalid JSON ({ex}); refusing to modify it\n"); sys.exit(2)
if not isinstance(data, dict): sys.exit(0)
key="sessionStart" if kind=="cursor" else "SessionStart"
hooks=data.get("hooks")
if not isinstance(hooks, dict) or not isinstance(hooks.get(key), list): sys.exit(0)
arr=hooks[key]
def ours(e):
    if not isinstance(e, dict): return False
    if tag in str(e.get("command","")): return True
    return any(isinstance(h,dict) and tag in str(h.get("command","")) for h in (e.get("hooks") or []))
new=[e for e in arr if not ours(e)]
if len(new)==len(arr): sys.exit(0)
if new: hooks[key]=new
else:
    del hooks[key]
    if not hooks: data.pop("hooks", None)
text=json.dumps(data, indent=2)+"\n"
d=os.path.dirname(f) or "."; fd,tmp=tempfile.mkstemp(dir=d, prefix=".ap-", suffix=".tmp")
try:
    with os.fdopen(fd,"w",encoding="utf-8") as o: o.write(text)
    os.replace(tmp,f)
except Exception as ex:
    try: os.unlink(tmp)
    except OSError: pass
    sys.stderr.write(f"[agent-primer] {f}: write failed ({ex})\n"); sys.exit(3)
PY
  then note "removed hook from $file"
  else FAILED=1; note "ERROR: failed to remove hook from $file"; fi
}

# Remove our [[hooks]] block (and its leading comment) from Kimi's config.toml.
unhook_kimi() { # unhook_kimi FILE [TAG]   (TAG may be a pipe-list of substrings)
  local file="$1" tag="${2:-$HOOK_TAG}"; [ -f "$file" ] || return 0
  if [ "$DRYRUN" = 1 ]; then note "would remove Kimi hook from $file"; return 0; fi
  if [ "$HAVE_PY" = 0 ]; then note "python3 not found — remove the [[hooks]] block running $tag from $file by hand"; return 0; fi
  if CG_FILE="$file" CG_TAG="$tag" "$PY" - <<'PY'
import os, re, sys, tempfile
f=os.environ["CG_FILE"]; tag=os.environ["CG_TAG"]; tags=[t for t in tag.split("|") if t]
txt=open(f,encoding="utf-8").read(); orig=txt
# Drop an optional leading comment + the [[hooks]] block (up to the next table header
# or EOF) when that block references any of our hook tags.
def repl(m): return "" if any(t in m.group(0) for t in tags) else m.group(0)
txt=re.sub(r"(?:^[ \t]*#[^\n]*\n)?^\[\[hooks\]\][^\[]*", repl, txt, flags=re.M)
if txt==orig: sys.exit(0)
txt=re.sub(r"\n{3,}", "\n\n", txt).lstrip("\n")
d=os.path.dirname(f) or "."; fd,tmp=tempfile.mkstemp(dir=d, prefix=".ap-", suffix=".tmp")
try:
    with os.fdopen(fd,"w",encoding="utf-8") as o: o.write(txt)
    os.replace(tmp,f)
except Exception as ex:
    try: os.unlink(tmp)
    except OSError: pass
    sys.stderr.write(f"[agent-primer] {f}: write failed ({ex})\n"); sys.exit(1)
PY
  then note "removed Kimi hook from $file"
  else FAILED=1; note "ERROR: failed to remove Kimi hook from $file"; fi
}

# Remove any hook entry whose command references TAG, from EVERY hooks.* array
# (SessionStart, sessionStart, PostToolUse). Used to pull the primer hooks.
unhook_tag() { # unhook_tag FILE TAG
  local file="$1" tag="$2"; [ -f "$file" ] || return 0
  if [ "$DRYRUN" = 1 ]; then note "would remove $tag hooks from $file"; return 0; fi
  if [ "$HAVE_PY" = 0 ]; then note "python3 not found — remove hook entries running $tag from $file by hand"; return 0; fi
  if CG_FILE="$file" CG_TAG="$tag" "$PY" - <<'PY'
import os, json, sys, tempfile
f=os.environ["CG_FILE"]; tag=os.environ["CG_TAG"]
raw=open(f,encoding="utf-8").read()
if not raw.strip(): sys.exit(0)
try: data=json.loads(raw)
except Exception as ex:
    sys.stderr.write(f"[agent-primer] {f}: invalid JSON ({ex}); refusing to modify it\n"); sys.exit(2)
if not isinstance(data, dict): sys.exit(0)
hooks=data.get("hooks")
if not isinstance(hooks, dict): sys.exit(0)
tags=[t for t in tag.split("|") if t]
def hit(cmd): return any(t in cmd for t in tags)
def ours(e):
    if not isinstance(e, dict): return False
    if hit(str(e.get("command",""))): return True
    return any(isinstance(h,dict) and hit(str(h.get("command",""))) for h in (e.get("hooks") or []))
changed=False
for key in list(hooks.keys()):
    arr=hooks.get(key)
    if not isinstance(arr, list): continue
    new=[e for e in arr if not ours(e)]
    if len(new)!=len(arr):
        changed=True
        if new: hooks[key]=new
        else: del hooks[key]
if not changed: sys.exit(0)
if not hooks: data.pop("hooks", None)
text=json.dumps(data, indent=2)+"\n"
d=os.path.dirname(f) or "."; fd,tmp=tempfile.mkstemp(dir=d, prefix=".ap-", suffix=".tmp")
try:
    with os.fdopen(fd,"w",encoding="utf-8") as o: o.write(text)
    os.replace(tmp,f)
except Exception as ex:
    try: os.unlink(tmp)
    except OSError: pass
    sys.stderr.write(f"[agent-primer] {f}: write failed ({ex})\n"); sys.exit(3)
PY
  then note "removed $tag hooks from $file"
  else FAILED=1; note "ERROR: failed to remove $tag hooks from $file"; fi
}

# Reverse install's Gemini `context.fileName` additions (AGENTS.md / GEMINI.md), but ONLY for
# entries whose instruction file is now gone — a dangling reference. If the file still exists the
# user may rely on it, so we leave it. Args after FILE are NAME=PATH pairs; NAME is pruned only when
# PATH does not exist. Tidies an emptied fileName/context. Atomic; refuses malformed JSON.
prune_gemini_filename() { # prune_gemini_filename SETTINGS_JSON NAME=PATH [NAME=PATH ...]
  local file="$1"; shift; [ -f "$file" ] || return 0
  local prune="" pair name path
  for pair in "$@"; do
    name="${pair%%=*}"; path="${pair#*=}"
    [ -e "$path" ] || prune="$prune $name"
  done
  prune="$(printf '%s' "$prune" | sed 's/^ *//')"
  [ -z "$prune" ] && return 0
  if [ "$DRYRUN" = 1 ]; then note "would prune dangling fileName entries ($prune) from $file"; return 0; fi
  if [ "$HAVE_PY" = 0 ]; then note "python3 not found — remove dangling [$prune] from context.fileName in $file by hand"; return 0; fi
  if CG_FILE="$file" CG_PRUNE="$prune" "$PY" - <<'PY'
import os, json, sys, tempfile
f=os.environ["CG_FILE"]; prune=set(os.environ["CG_PRUNE"].split())
raw=open(f,encoding="utf-8").read()
if not raw.strip(): sys.exit(0)
try: data=json.loads(raw)
except Exception as ex:
    sys.stderr.write(f"[agent-primer] {f}: invalid JSON ({ex}); refusing to modify it\n"); sys.exit(2)
if not isinstance(data, dict): sys.exit(0)
ctx=data.get("context")
if not isinstance(ctx, dict): sys.exit(0)
names=ctx.get("fileName")
if isinstance(names, str): names=[names]
if not isinstance(names, list): sys.exit(0)
new=[n for n in names if n not in prune]
if new==names: sys.exit(0)
if new: ctx["fileName"]=new
else:
    ctx.pop("fileName", None)
    if not ctx: data.pop("context", None)
text=json.dumps(data, indent=2)+"\n"
d=os.path.dirname(f) or "."; fd,tmp=tempfile.mkstemp(dir=d, prefix=".ap-", suffix=".tmp")
try:
    with os.fdopen(fd,"w",encoding="utf-8") as o: o.write(text)
    os.replace(tmp,f)
except Exception as ex:
    try: os.unlink(tmp)
    except OSError: pass
    sys.stderr.write(f"[agent-primer] {f}: write failed ({ex})\n"); sys.exit(3)
PY
  then note "pruned dangling fileName entries ($prune) from $file"
  else FAILED=1; note "ERROR: failed to prune fileName entries from $file"; fi
}

note "uninstall scope=$SCOPE target=$ROOT  agents=$AGENTS  dry-run=$DRYRUN  purge=$PURGE"

if selected claude; then
  if [ "$CLAUDE_RULE_MODE" = "append" ]; then strip_markers "$CLAUDE_RULE"
  else for n in $STANDALONE_NAMES; do rm_path "$CLAUDE_RULE_DIR/$n.md"; done; fi
  unhook_json "$SETTINGS" claude
fi
if selected codex; then strip_markers "$CODEX_INSTR"; unhook_json "$CFILE" codex; fi
if selected cursor; then
  [ -n "$CURSOR_RULE_DIR" ] && for n in $STANDALONE_NAMES; do rm_path "$CURSOR_RULE_DIR/$n.mdc"; done
  unhook_json "$HFILE" cursor
fi
if selected gemini; then
  strip_markers "$GEMINI_INSTR"; unhook_json "$GS" gemini
  # Reverse install's context.fileName additions — but only entries now pointing at a deleted
  # file (strip_markers removes GEMINI.md/AGENTS.md when they held only our blocks). A file the
  # user still has is left referenced. AGENTS.md is project-scope only: globally that entry means
  # "read each project's AGENTS.md", which agent-primer's global install does not own.
  if [ "$SCOPE" = "project" ]; then prune_gemini_filename "$GS" "GEMINI.md=$GEMINI_INSTR" "AGENTS.md=$ROOT/AGENTS.md"
  else prune_gemini_filename "$GS" "GEMINI.md=$GEMINI_INSTR"; fi
fi
if selected opencode; then rm_path "$OPENCODE_PLUG"; rm_path "${OPENCODE_PLUG%/*}/primer-session-check.js"; strip_markers "$OPENCODE_INSTR"; fi
if selected antigravity; then
  [ -n "$ANTI_RULE_DIR" ] && for n in $STANDALONE_NAMES; do rm_path "$ANTI_RULE_DIR/$n.md"; done
  strip_markers "$ANTI_INSTR"; unhook_json "$AH" antigravity
fi
if selected kimi; then
  for n in $KIMI_SKILL_NAMES; do rm_path "$KIMI_SKILLS/$n"; done
  [ "$SCOPE" = "global" ] && unhook_kimi "$KCONF" "$HOOK_TAG|$PRIMER_TAG"
fi
if selected qoder; then
  [ -n "$QODER_RULE_DIR" ] && for n in $STANDALONE_NAMES; do rm_path "$QODER_RULE_DIR/$n.md"; done
  [ -n "$QODER_INSTR" ] && strip_markers "$QODER_INSTR"
fi

# --- remove primer wiring (brief/capture hooks + MCP entries); PRESERVE the DB ---
# primer hooks live alongside the core ones in the same JSON configs — strip by tag from every
# hooks.* array. MCP entries come out via `primer uninstall`. The learned DB is kept unless --purge.
selected claude      && unhook_tag "$SETTINGS" "$PRIMER_TAG"
selected cursor      && unhook_tag "$HFILE" "$PRIMER_TAG"
selected gemini      && unhook_tag "$GS" "$PRIMER_TAG"
selected codex       && unhook_tag "$CFILE" "$PRIMER_TAG"
selected antigravity && unhook_tag "$AH" "$PRIMER_TAG"
if [ -f "$PRIMER_JS" ] && command -v node >/dev/null 2>&1 && [ "$DRYRUN" = 0 ]; then
  PRIMER_TARGETS=""
  for _ag in claude cursor gemini codex opencode; do selected "$_ag" && PRIMER_TARGETS="$PRIMER_TARGETS,$_ag"; done
  PRIMER_TARGETS="${PRIMER_TARGETS#,}"
  if [ -n "$PRIMER_TARGETS" ]; then
    if [ "$SCOPE" = "project" ]; then node "$PRIMER_JS" uninstall --local --cwd "$ROOT" --target "$PRIMER_TARGETS" 2>&1 | sed 's/^/[agent-primer] /'
    else node "$PRIMER_JS" uninstall --target "$PRIMER_TARGETS" 2>&1 | sed 's/^/[agent-primer] /'; fi
  fi
fi
# The learned style DB is the user's data — preserve it unless --purge.
PRIMER_DB_DIR="$ROOT/.primer"
if [ -d "$PRIMER_DB_DIR" ]; then
  if [ "$PURGE" = 1 ]; then rm_path "$PRIMER_DB_DIR"
  else note "preserved your learned primer style DB at $PRIMER_DB_DIR (re-run with --purge to delete it)"; fi
fi

# Remove the kit dir last (it's wholly owned by agent-primer).
rm_path "$KIT_DEST"

# agent-primer's own wiring is now gone. It does NOT remove the tools its policies had
# agents *install* — those are independent (esp. the CodeGraph CLI, which you may use
# outside this kit). Print exact teardown commands for them; never run them.
cat <<'EOF'

[agent-primer] Removed agent-primer's wiring. The tools its policies bootstrapped were left
in place. To remove those yourself (optional):

  CodeGraph CLI — only if you don't use it outside this kit:
    codegraph uninstall                        # unregister its MCP server from your agents
    codegraph uninit                           # run inside a repo to delete that project's .codegraph/ index
    npm uninstall -g @colbymchenry/codegraph   # remove the CLI itself (if installed via npm)

  Superpowers:
    plugin  — remove via your agent's plugin manager (e.g. /plugin in Claude Code; the
              marketplace UI in Cursor / Codex / Gemini / …): https://github.com/obra/superpowers
    skills  — delete the obra/superpowers skills that 'npx skills add' wrote into your
              skills directory (run 'npx skills --help' for a remove command)
EOF

if [ "$FAILED" = 0 ]; then note "uninstall done."; else note "uninstall done — but some steps FAILED (see ERROR lines above)."; fi
exit "$FAILED"
