import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import { ESLint } from "eslint";

const require = createRequire(import.meta.url);
const pluginRequire = createRequire(require.resolve("@next/eslint-plugin-next"));
const { getRootDirs } = pluginRequire("./utils/get-root-dirs") as {
  getRootDirs(context: { cwd: string; settings: { next?: { rootDir: unknown } } }): string[];
};
let fixture: string;
let alpha: string;
let beta: string;

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), "fundflow-lint-glob-"));
  alpha = join(fixture, "alpha");
  beta = join(fixture, "beta");
  mkdirSync(join(alpha, "pages"), { recursive: true });
  mkdirSync(join(beta, "app"), { recursive: true });
  writeFileSync(join(alpha, "pages", "about.tsx"), "export default function About() { return null; }");
  writeFileSync(join(fixture, "not-a-directory.txt"), "fixture");
});
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

function roots(rootDir: unknown): string[] {
  return getRootDirs({ cwd: fixture, settings: { next: { rootDir } } }).sort();
}

describe("Next lint glob replacement", () => {
  it("retains the default root and matches literal directories without descendants", () => {
    expect(getRootDirs({ cwd: fixture, settings: {} })).toEqual([fixture]);
    expect(roots(alpha)).toEqual([alpha]);
    expect(roots(relative(process.cwd(), alpha))).toEqual([relative(process.cwd(), alpha)]);
    expect(roots(`${alpha}/`).map((path) => path.replace(/\/$/, ""))).toEqual([alpha]);
  });

  it("supports wildcard, brace, Windows separator, and mixed-array root settings", () => {
    expect(roots(`${fixture}/*`)).toEqual([alpha, beta]);
    expect(roots(`${fixture}/{alpha,beta}`)).toEqual([alpha, beta]);
    expect(roots(alpha.replaceAll("/", "\\"))).toEqual([alpha]);
    expect(roots([alpha, beta, 42])).toEqual([alpha, beta]);
    expect(roots(`${fixture}/missing`)).toEqual([]);
  });

  it("still reports internal HTML links through the installed Next ESLint rule", async () => {
    const eslint = new ESLint({
      cwd: fixture,
      overrideConfigFile: true,
      overrideConfig: [{
        files: ["**/*.jsx"],
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { "@next/next": require("@next/eslint-plugin-next") },
        settings: { next: { rootDir: `${fixture}/{alpha,beta}` } },
        rules: { "@next/next/no-html-link-for-pages": "error" },
      }],
    });
    const [bad] = await eslint.lintText('export default () => <a href="/about">About</a>', { filePath: "component.jsx" });
    expect(bad.messages.map((message) => message.ruleId)).toContain("@next/next/no-html-link-for-pages");
    const [good] = await eslint.lintText('export default () => <a href="https://example.com">External</a>', { filePath: "component.jsx" });
    expect(good.messages).toEqual([]);
  });
});
