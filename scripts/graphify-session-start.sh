#!/bin/sh
# SessionStart hook: make an agent's first move in this repo an informed one.
#
# Answers three questions the agent would otherwise have to discover by
# failing: is graphify installed, is there a graph to query, and what are the
# commands. If the graph is missing it starts an AST-only rebuild in the
# background (no API key, no cost) rather than blocking startup on it.
#
# Same contract as graphify-hook.sh: never fail, never block. Exit 0 always.
set -u

emit() {
  # Claude Code reads additionalContext off SessionStart. python3 does the
  # JSON escaping, since the payload contains quotes and backticks.
  python3 -c '
import json,sys
print(json.dumps({"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":sys.argv[1]}}))
' "$1" 2>/dev/null || true
}

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

root=${CLAUDE_PROJECT_DIR:-$(pwd)}
cd "$root" 2>/dev/null || exit 0

CHEATSHEET='graphify commands: `graphify query "<question>"` (scoped subgraph, the default move for a codebase question), `graphify explain "<concept>"`, `graphify path "<A>" "<B>"`, `graphify affected "<symbol>"` (reverse impact), `graphify god-nodes` (architectural hubs), `graphify update .` (refresh after edits, AST-only, no API cost).'

if ! bin=$(resolve); then
  emit "graphify is NOT installed, so the knowledge graph in this repo is unavailable and its hooks are no-ops. Install it with: uv tool install \"graphifyy[gemini,mcp]\" . Until then, fall back to grep/read. Do not tell the user graphify is broken; it is simply not installed."
  exit 0
fi

if [ ! -f graphify-out/graph.json ]; then
  # Lock so parallel sessions do not each kick off a rebuild. Kept in TMPDIR
  # rather than .git/, because not every project here is a git repo. A lock
  # older than 10 minutes is treated as stale, so a crashed build cannot
  # wedge the bootstrap permanently.
  key=$(printf '%s' "$root" | shasum 2>/dev/null | cut -c1-12)
  [ -z "$key" ] && key=default
  lock="${TMPDIR:-/tmp}/graphify-boot-$key"
  if [ -d "$lock" ]; then
    if [ -z "$(find "$lock" -maxdepth 0 -mmin -10 2>/dev/null)" ]; then
      rmdir "$lock" 2>/dev/null || true
    fi
  fi
  if mkdir "$lock" 2>/dev/null; then
    ( "$bin" update . >/dev/null 2>&1; rmdir "$lock" 2>/dev/null ) &
    emit "graphify: no graph found, so an AST-only rebuild was started in the background (typically 10-30s, no API key, no cost). It is NOT ready yet. Use grep/read for now; re-check with \`test -f graphify-out/graph.json\` before relying on graphify. $CHEATSHEET"
  else
    emit "graphify: a graph rebuild is already running in another session. Use grep/read until graphify-out/graph.json appears. $CHEATSHEET"
  fi
  exit 0
fi

stats=$(python3 - <<'PYEOF' 2>/dev/null
import json
try:
    g = json.load(open("graphify-out/graph.json"))
    n = len(g.get("nodes", []))
    e = len(g.get("links", g.get("edges", [])))
    print(f"{n} nodes, {e} edges")
except Exception:
    pass
PYEOF
)
[ -n "$stats" ] && stats=" Graph: $stats."

emit "graphify knowledge graph is available for this repo.${stats} Prefer it over grep for codebase questions. $CHEATSHEET"
exit 0
