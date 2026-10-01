import { readFile } from "node:fs/promises";
import path from "node:path";
import { rolldown } from "rolldown";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

let script: string;
let css: string;

test.beforeAll(async () => {
  const root = process.cwd();
  const bundle = await rolldown({
    input: "palette-fixture",
    platform: "browser",
    onwarn(warning, warn) {
      // Client directives have no server boundary in this browser-only fixture.
      if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
    },
    resolve: { alias: { "@": root } },
    transform: { define: { "process.env.NODE_ENV": '"production"' }, jsx: "react-jsx" },
    plugins: [{
      name: "palette-fixture",
      resolveId(id) {
        if (["palette-fixture", "next/navigation"].includes(id)) return `\0${id}`;
      },
      load(id) {
        if (id === "\0next/navigation") return 'export function useRouter() { return { push(href) { document.body.dataset.destination = href; } }; }';
        if (id === "\0palette-fixture") return `
          import { createElement } from "react";
          import { createRoot } from "react-dom/client";
          import ApiTokensSection from ${JSON.stringify(path.join(root, "components/settings/ApiTokensSection.tsx"))};
          createRoot(document.getElementById("root")).render(createElement(ApiTokensSection, { initialTokens: [{ id: "token", name: "Export script", created_at: "2026-09-01", expires_at: "2026-12-01", last_used_at: null }] }));
        `;
      },
    }],
  });
  try {
    const result = await bundle.generate({ format: "iife" });
    script = result.output[0]!.code;
  } finally {
    await bundle.close();
  }
  const source = path.join(root, "app/globals.css");
  css = (await postcss([tailwind()]).process(await readFile(source, "utf8"), { from: source })).css;
});


for (const width of [375, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`token reauthentication at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      let submitted: unknown;
      await page.route("http://fundflow.test/**", async route => {
        if (route.request().url().endsWith("/api/tokens")) {
          submitted = route.request().postDataJSON();
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "fft_test_fixture_only", row: { id: "new", name: "Report", created_at: "2026-10-01", expires_at: "2026-12-30" } }) });
        } else await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en" data-theme="${theme}"><head><title>Token settings</title><style>${css}</style></head><body><main style="padding:16px"><h1>Integrations</h1><div id="root"></div></main></body></html>` });
      });
      await page.goto("http://fundflow.test/");
      await page.addScriptTag({ content: script });
      await expect(page.getByText(/expires 2026-12-01/)).toBeVisible();
      await page.getByLabel("Token name").fill("Report");
      const proof = page.getByLabel("Authenticator code, or password if MFA is off");
      await proof.fill("123456");
      await proof.press("Tab");
      await expect(page.getByRole("button", { name: "Create token" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByText("fft_test_fixture_only")).toBeVisible();
      expect(submitted).toEqual({ name: "Report", code: "123456" });
      await expect(proof).toHaveValue("");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("token-settings.png"), fullPage: true });
    });
  }
}

test("signed-out invitation preserves its return path on the real login page", async ({ page }) => {
  await page.goto("http://localhost:4317/household/accept?token=local-synthetic-invitation");
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/household/accept?token=local-synthetic-invitation");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});
