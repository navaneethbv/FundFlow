# Next lint glob adapter

Next's ESLint plugin 16.3.8 uses `fast-glob` only for `globSync(pattern, { onlyDirectories: true })` in `get-root-dirs`.
That package pulls in `braces` through `micromatch`, with no patched release for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The version-scoped npm override replaces that dependency with this small adapter over MIT-licensed `tinyglobby`.
The vulnerable packages are removed, not allowlisted, and the full npm audit gate remains unchanged.

`expandDirectories: false` preserves literal-directory matching, as required by the [tinyglobby migration guide](https://superchupu.dev/tinyglobby/migration#switching-from-fast-glob).
This is not a general replacement for the entire fast-glob API.
The adapter retains absolute versus relative results and normalizes trailing directory separators.
It requires Node 22.12 or later, matching the repository's Node 22 CI line and allowing the CommonJS plugin to load this synchronous ES module.
`tests/unit/next-lint-glob.test.ts` exercises the installed plugin's directory discovery and real ESLint rule reporting.
Reassess and remove the override when upgrading the plugin to an upstream release without the vulnerable dependency chain.
