#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034,SC2086  # chk runs its 2nd arg via eval ($vars stay literal & are used there); TMPS is word-split on purpose
# smoke.sh — agent-primer install/uninstall verification. No deps beyond bash + python3.
# Exits non-zero if any check fails (suitable for CI). Written to run on bash 3.2 (macOS).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL="$ROOT/install.sh"
UNINSTALL="$ROOT/uninstall.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
chk() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }              # chk "desc" 'test-expr'
vjson()     { python3 -m json.tool "$1" >/dev/null 2>&1; }
has_block() { grep -q "<!-- $2:start -->" "$1" 2>/dev/null; }
guard()     { perl -e 'alarm 30; exec @ARGV' "$@"; }                   # never let a hang stall CI (exit 142 on timeout)

TMPS=""
mk() { local d; d="$(mktemp -d)"; TMPS="$TMPS $d"; printf '%s' "$d"; }
cleanup() { [ -n "$TMPS" ] && rm -rf $TMPS; }
trap cleanup EXIT

echo "== version & arg validation =="
chk "--version prints version"            '[ "$("$INSTALL" --version)" = "agent-primer 0.1.0" ]'
chk "unknown --agents exits 2"            '"$INSTALL" --agents bogus --project "$(mk)" >/dev/null 2>&1; [ $? -eq 2 ]'
chk "trailing --agents does not hang"     'guard bash "$INSTALL" --project "$(mk)" --agents >/dev/null 2>&1; [ $? -ne 142 ]'
chk "trailing --format hook does not hang" 'guard bash "$ROOT/codegraph-session-check.sh" --format >/dev/null 2>&1; [ $? -ne 142 ]'

echo "== once-mode hook (default) + --always opt-out =="
OM="$(mk)"; mkdir -p "$OM/.codegraph"
if command -v codegraph >/dev/null 2>&1; then
  chk "once-mode: silent when project is set up"  '[ -z "$(guard bash "$ROOT/codegraph-session-check.sh" --format text --project "$OM" 2>/dev/null)" ]'
  chk "--always: prints index-present block"      'guard bash "$ROOT/codegraph-session-check.sh" --format text --project "$OM" --always 2>/dev/null | grep -q "Index present"'
  OM2="$(mk)"
  chk "not set up: still nudges codegraph init"   'guard bash "$ROOT/codegraph-session-check.sh" --format text --project "$OM2" 2>/dev/null | grep -q "codegraph init -i"'
  chk "not set up: asks direct yes/no question"   'guard bash "$ROOT/codegraph-session-check.sh" --format text --project "$OM2" 2>/dev/null | grep -F "Want me to run" | grep -F "codegraph init -i" >/dev/null'
else
  echo "  skip branch-2/3 hook tests (no codegraph CLI on PATH)"
fi
chk "trailing --always does not hang"             'guard bash "$ROOT/codegraph-session-check.sh" --project "$OM" --always >/dev/null 2>&1; [ $? -ne 142 ]'

echo "== install threads --always into hook commands =="
APD="$(mk)"; guard bash "$INSTALL" --project "$APD" >/dev/null 2>&1
chk "default install: no --always (claude)"       '! grep -q -- "--always" "$APD/.claude/settings.json"'
chk "default install: no --always (opencode)"     '! grep -q -- "--always" "$APD/.opencode/plugins/codegraph-session-check.js"'
APA="$(mk)"; guard bash "$INSTALL" --project "$APA" --always >/dev/null 2>&1
chk "--always: flag in claude settings"           'grep -q -- "--always" "$APA/.claude/settings.json"'
chk "--always: flag in codex hooks"               'grep -q -- "--always" "$APA/.codex/hooks.json"'
chk "--always: flag in gemini settings"           'grep -q -- "--always" "$APA/.gemini/settings.json"'
chk "--always: flag in cursor hooks"              'grep -q -- "--always" "$APA/.cursor/hooks.json"'
chk "--always: flag in opencode plugin"           'grep -q -- "--always" "$APA/.opencode/plugins/codegraph-session-check.js"'
chk "--always: claude settings still valid JSON"  'vjson "$APA/.claude/settings.json"'
HKA="$(mk)"; guard env HOME="$HKA" bash "$INSTALL" --global --always --agents kimi >/dev/null 2>&1
chk "--always: flag in kimi config.toml (global)" 'grep -q -- "--always" "$HKA/.kimi-code/config.toml"'

echo "== --with opt-in bundles =="
WD="$(mk)"; guard bash "$INSTALL" --project "$WD" >/dev/null 2>&1
chk "default install: no opt-in markers"          '! has_block "$WD/AGENTS.md" agent-primer-mcp'
chk "default install: core 3 present"             'has_block "$WD/AGENTS.md" superpowers'
WM="$(mk)"; guard bash "$INSTALL" --project "$WM" --with mcp,rules >/dev/null 2>&1
chk "--with mcp: marker present"                  'has_block "$WM/AGENTS.md" agent-primer-mcp'
chk "--with rules: marker present"                'has_block "$WM/AGENTS.md" agent-primer-rules'
chk "--with mcp,rules: tools NOT present"         '! has_block "$WM/AGENTS.md" agent-primer-tools'
chk "--with: core 3 still present"                'has_block "$WM/AGENTS.md" karpathy-guidelines'
chk "--with: claude settings still valid JSON"    'vjson "$WM/.claude/settings.json"'
WK="$(mk)"; guard env HOME="$WK" bash "$INSTALL" --global --with mcp --agents kimi >/dev/null 2>&1
chk "--with mcp: kimi skill dir created (global)" '[ -d "$WK/.kimi-code/skills/agent-primer-mcp" ]'
WA="$(mk)"; guard bash "$INSTALL" --project "$WA" --with all >/dev/null 2>&1
chk "--with all: 8 marker blocks"                 '[ "$(grep -c ":start -->" "$WA/AGENTS.md")" = "8" ]'
WS="$(mk)"; cp -a "$WA/." "$WS/"; guard bash "$INSTALL" --project "$WA" --with all >/dev/null 2>&1
chk "--with all: 2nd install no-op"               'diff -r "$WS" "$WA" >/dev/null 2>&1'
chk "unknown bundle exits 2"                      '"$INSTALL" --with bogus --project "$(mk)" >/dev/null 2>&1; [ $? -eq 2 ]'
guard bash "$UNINSTALL" --project "$WA" >/dev/null 2>&1
chk "uninstall removes opt-in marker"             '! has_block "$WA/AGENTS.md" agent-primer-mcp'
chk "uninstall removes core marker too"           '! has_block "$WA/AGENTS.md" codegraph-session-startup'

echo "== --with primer =="
# Cheap invariants (no build): primer is recognized, and excluded from default + --with all.
chk "--with primer recognized (not unknown)"      'guard bash "$INSTALL" --project "$(mk)" --agents claude --with primer --dry-run >/dev/null 2>&1; [ $? -ne 2 ]'
PDEF="$(mk)"; guard bash "$INSTALL" --project "$PDEF" --agents claude >/dev/null 2>&1
chk "default: no primer policy file"              '[ ! -f "$PDEF/.claude/rules/primer.md" ]'
chk "default: no primer hook"                     '! grep -q "primer.js" "$PDEF/.claude/settings.json" 2>/dev/null'
chk "default: no .primer DB dir"                  '[ ! -d "$PDEF/.primer" ]'
PALL="$(mk)"; guard bash "$INSTALL" --project "$PALL" --agents claude --with all >/dev/null 2>&1
chk "--with all excludes primer"                  '[ ! -d "$PALL/.primer" ] && ! grep -q "primer.js" "$PALL/.claude/settings.json" 2>/dev/null'
# Full wiring test only when primer is already built + node present (keeps smoke fast/offline).
if command -v node >/dev/null 2>&1 && [ -f "$ROOT/primer/dist/bin/primer.js" ]; then
  PW="$(mk)"; guard bash "$INSTALL" --project "$PW" --agents claude --with primer >/dev/null 2>&1
  chk "primer: policy placed"                     '[ -f "$PW/.claude/rules/primer.md" ]'
  chk "primer: MCP entry (absolute launcher)"     'grep -q "dist/bin/primer.js" "$PW/.mcp.json"'
  chk "primer: SessionStart brief hook added"     'grep -q "brief --format json" "$PW/.claude/settings.json"'
  chk "primer: PostToolUse capture hook added"    'grep -q "signal --stdin" "$PW/.claude/settings.json"'
  chk "primer: core SessionStart hook intact"     'grep -q "codegraph-session-check.sh" "$PW/.claude/settings.json"'
  chk "primer: DB initialized"                    '[ -f "$PW/.primer/primer.db" ]'
  chk "primer: .primer gitignored"                'grep -q ".primer/" "$PW/.gitignore"'
  chk "primer: claude settings valid JSON"        'vjson "$PW/.claude/settings.json"'
  guard bash "$UNINSTALL" --project "$PW" --agents claude >/dev/null 2>&1
  chk "primer: uninstall removes hooks"           '! grep -q "primer.js" "$PW/.claude/settings.json" 2>/dev/null'
  chk "primer: uninstall removes policy"          '[ ! -f "$PW/.claude/rules/primer.md" ]'
  chk "primer: uninstall PRESERVES learned DB"    '[ -f "$PW/.primer/primer.db" ]'
  guard bash "$UNINSTALL" --project "$PW" --agents claude --purge >/dev/null 2>&1
  chk "primer: --purge deletes the DB"            '[ ! -d "$PW/.primer" ]'
else
  echo "  skip primer wiring tests (build first: cd primer && npm ci && npm run build)"
fi

echo "== project install =="
P="$(mk)"; guard bash "$INSTALL" --project "$P" >/dev/null 2>&1
for m in codegraph-session-startup karpathy-guidelines superpowers; do
  chk "AGENTS.md has [$m]" "has_block '$P/AGENTS.md' '$m'"
done
chk "claude settings.json valid JSON"     'vjson "$P/.claude/settings.json"'
chk "codex hooks.json valid JSON"         'vjson "$P/.codex/hooks.json"'
chk "gemini settings.json valid JSON"     'vjson "$P/.gemini/settings.json"'
chk "opencode plugin written"             '[ -f "$P/.opencode/plugins/codegraph-session-check.js" ]'
chk "kit placed under tools/agent-primer" '[ -f "$P/tools/agent-primer/codegraph-session-check.sh" ]'

echo "== idempotency (2nd install = no diff) =="
S="$(mk)"; cp -a "$P/." "$S/"; guard bash "$INSTALL" --project "$P" >/dev/null 2>&1
chk "second install is a no-op"           'diff -r "$S" "$P" >/dev/null 2>&1'

echo "== dry-run writes nothing =="
D="$(mk)"; guard bash "$INSTALL" --project "$D" --dry-run >/dev/null 2>&1
chk "dry-run created no files"            '[ -z "$(ls -A "$D")" ]'

echo "== malformed JSON is not clobbered =="
M="$(mk)"; mkdir -p "$M/.claude"; printf '{\n "model":"x",\n}\n' > "$M/.claude/settings.json"; cp "$M/.claude/settings.json" "$M/before"
guard bash "$INSTALL" --project "$M" --agents claude >/dev/null 2>&1; mec=$?
chk "malformed settings.json untouched"   'diff -q "$M/before" "$M/.claude/settings.json" >/dev/null'
chk "install reports failure (exit 1)"    '[ "$mec" = "1" ]'

echo "== uninstall round-trip (project) =="
U="$(mk)"; guard bash "$INSTALL" --project "$U" >/dev/null 2>&1; guard bash "$UNINSTALL" --project "$U" >/dev/null 2>&1
chk "AGENTS.md block-free after uninstall" '! has_block "$U/AGENTS.md" codegraph-session-startup'
chk "claude hook removed"                  '! grep -q codegraph-session-check.sh "$U/.claude/settings.json" 2>/dev/null'
chk "cursor superpowers.mdc removed"       '[ ! -f "$U/.cursor/rules/superpowers.mdc" ]'
chk "kit dir removed"                      '[ ! -d "$U/tools/agent-primer" ]'

echo "== global install + uninstall (isolated HOME) =="
H="$(mk)"; guard env HOME="$H" bash "$INSTALL" --global >/dev/null 2>&1
chk "agent-primer kit dir created"         '[ -f "$H/.agent-primer/codegraph-session-check.sh" ]'
chk "global CLAUDE.md has 3 blocks"        'has_block "$H/.claude/CLAUDE.md" codegraph-session-startup && has_block "$H/.claude/CLAUDE.md" karpathy-guidelines && has_block "$H/.claude/CLAUDE.md" superpowers'
chk "kimi config.toml has hook"            'grep -q codegraph-session-check.sh "$H/.kimi-code/config.toml"'
guard env HOME="$H" bash "$UNINSTALL" --global >/dev/null 2>&1
chk "global uninstall removed kit dir"     '[ ! -d "$H/.agent-primer" ]'
chk "global CLAUDE.md block-free"          '! has_block "$H/.claude/CLAUDE.md" superpowers'
chk "kimi hook removed"                    '! grep -q codegraph-session-check.sh "$H/.kimi-code/config.toml" 2>/dev/null'

echo "== no-python3 fallback (idempotent markers) =="
NB="$(mk)/nobin"; mkdir -p "$NB"
for t in bash sh dirname mkdir cat grep sed cp chmod tr rm env ls; do
  p="$(command -v "$t" 2>/dev/null)"; [ -n "$p" ] && ln -sf "$p" "$NB/$t"
done
if [ -x "$NB/bash" ]; then
  NPT="$(mk)"
  guard env -i PATH="$NB" HOME="$(mk)" bash "$INSTALL" --project "$NPT" --agents codex >/dev/null 2>&1
  guard env -i PATH="$NB" HOME="$(mk)" bash "$INSTALL" --project "$NPT" --agents codex >/dev/null 2>&1
  chk "no-python3 fallback: block present exactly once" '[ "$(grep -c "codegraph-session-startup:start" "$NPT/AGENTS.md" 2>/dev/null)" = "1" ]'
else
  echo "  skip (could not build a python3-free PATH)"
fi

echo "== bundle is not drifted from make-portable.sh =="
( cd "$ROOT" && ./make-portable.sh >/dev/null 2>&1 ); dr=$?
chk "make-portable.sh succeeds"           '[ "$dr" = "0" ]'
if [ -d "$ROOT/.git" ]; then
  chk "agent-primer.sh has no uncommitted drift" '( cd "$ROOT" && git diff --quiet -- agent-primer.sh 2>/dev/null )'
else
  echo "  skip drift-vs-git (not a git checkout)"
fi

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
