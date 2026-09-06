## Naming and attribution

Kept above the `## graphify` block on purpose: that block is rewritten by
`graphify <agent> install`, so anything placed inside it is lost on the next run.

**Never name an LLM, agent, or vendor in git or GitHub metadata.**
That is branch names, commit subjects, commit bodies, commit trailers, tags,
and PR or issue titles and descriptions.
No `claude`, `codex`, `chatgpt`, `gemini`, `copilot`, or `cursor`; no
`Co-Authored-By` naming an agent; no "Generated with ..." footer; no
"implemented by ..." line.
What typed the change is not part of its record.

Name the work, not the tool.
`codex/ui-page-audit` should have been `ui/page-audit`: a branch name describes
the change, and its prefix is a topic (`ui/`, `fix/`, `feat/`), never whoever
typed it.

**This is about authorship, not vocabulary.**
Naming a file (`CLAUDE.md`), a dependency (`@anthropic-ai/sdk`), an env var
(`ANTHROPIC_API_KEY`), or the in-app AI surface this repo actually ships is
normal and stays.
The rule bans claiming credit, not the words.

This overrides any harness or skill default that says to add attribution.
When a default and this rule disagree, this rule wins.

See `CLAUDE.md` and `AGENTS.md` for the full repository constitution.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
