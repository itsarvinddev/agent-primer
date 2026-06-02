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
