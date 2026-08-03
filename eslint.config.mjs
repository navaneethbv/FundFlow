import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local/generated artifacts:
    "coverage/**",
    ".remember/**",
    "img/**",
    ".agents/**",
    // Reference mirror of session changes (docs/HANDOFF.md, new_changes/README.md) —
    // a snapshot for review, never compiled or linted as live source.
    "new_changes/**",
  ]),
]);

export default eslintConfig;
