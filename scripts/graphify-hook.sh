#!/bin/sh
# Agent hook shim for graphify.
#
# Every agent's hook config would otherwise hardcode an absolute path to the
# graphify binary, which is machine-specific: it breaks on a teammate's
# checkout, in CI, and after a reinstall to a different prefix. This resolves
# graphify at call time instead.
#
# Contract: NEVER fail, and never block the agent. A missing graphify, a
# missing graph, or a broken install must all be a silent no-op, because this
# runs before every matched tool call. Exit 0 unconditionally.
#
# Usage: sh scripts/graphify-hook.sh <mode>
#   search | read   Claude Code PreToolUse guards
#   gemini          Gemini CLI BeforeTool guard
#   hook-check      Codex PreToolUse (intentional no-op upstream)
set -u

mode=${1:-search}

# GRAPHIFY_BIN wins, so a non-standard install can be pointed at explicitly.
resolve() {
  if [ -n "${GRAPHIFY_BIN:-}" ] && [ -x "${GRAPHIFY_BIN}" ]; then
    printf '%s' "$GRAPHIFY_BIN"; return 0
  fi
  found=$(command -v graphify 2>/dev/null) && [ -n "$found" ] && {
    printf '%s' "$found"; return 0
  }
  for c in \
    "$HOME/.local/bin/graphify" \
    "$HOME/.local/share/uv/tools/graphifyy/bin/graphify" \
    "/opt/homebrew/bin/graphify" \
    "/usr/local/bin/graphify"
  do
    [ -x "$c" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

bin=$(resolve) || exit 0

if [ "$mode" = "hook-check" ]; then
  "$bin" hook-check >/dev/null 2>&1
  exit 0
fi

"$bin" hook-guard "$mode" 2>/dev/null || true
exit 0
