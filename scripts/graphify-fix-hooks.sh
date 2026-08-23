#!/bin/sh
# Re-point this repo's agent hook configs at scripts/graphify-hook.sh.
#
# `graphify <agent> install` rewrites .claude/settings.json, .gemini/settings.json
# and .codex/hooks.json every time it runs, and it writes an ABSOLUTE path to
# whichever graphify binary it found. That path is machine-specific, so a
# committed config built that way breaks on a teammate's checkout and in CI.
# Run this after any graphify install to put the portable shim back.
#
# Idempotent. Exits non-zero only on malformed JSON.
set -eu
cd "$(dirname "$0")/.."

python3 - <<'PY'
import json, io, os

TARGETS = {
    ".claude/settings.json": 'sh "$CLAUDE_PROJECT_DIR/scripts/graphify-hook.sh"',
    ".gemini/settings.json": "sh scripts/graphify-hook.sh",
    ".codex/hooks.json":     "sh scripts/graphify-hook.sh",
}
MODES = (
    ("hook-guard search", "search"), ("hook-guard read", "read"),
    ("hook-guard gemini", "gemini"), ("hook-check", "hook-check"),
)

changed = []
for path, prefix in TARGETS.items():
    if not os.path.exists(path):
        continue
    c = json.load(io.open(path, encoding="utf-8"))
    hit = [False]

    def walk(o):
        if isinstance(o, dict):
            for k, v in list(o.items()):
                if k == "command" and isinstance(v, str) and "graphify" in v:
                    mode = next((m for needle, m in MODES if needle in v), None)
                    if mode is None:
                        continue
                    new = f"{prefix} {mode}"
                    if new != v:
                        o[k] = new
                        hit[0] = True
                else:
                    walk(v)
        elif isinstance(o, list):
            for i in o:
                walk(i)

    walk(c)

    # SessionStart is ours; the installer never writes it, so re-add if missing.
    if path == ".claude/settings.json":
        hooks = c.setdefault("hooks", {})
        ss = hooks.setdefault("SessionStart", [])
        cmd = 'sh "$CLAUDE_PROJECT_DIR/scripts/graphify-session-start.sh"'
        if not any(cmd in h.get("command", "")
                   for e in ss for h in e.get("hooks", [])):
            ss.append({"hooks": [{"type": "command", "command": cmd}]})
            hit[0] = True

    if hit[0]:
        io.open(path, "w", encoding="utf-8").write(json.dumps(c, indent=2) + "\n")
        changed.append(path)

print("repointed: " + (", ".join(changed) if changed else "nothing (already portable)"))
PY

# The installer drops these next to each config it rewrites.
find . -maxdepth 2 -name '*.graphify-bak' -delete 2>/dev/null || true
