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
          import CommandPalette from ${JSON.stringify(path.join(root, "components/CommandPalette.tsx"))};
          const items = Array.from({length: 30}, (_, index) => ({ label: "Destination " + index, href: "/destination/" + index, hint: "Open destination " + index }));
          createRoot(document.getElementById("root")).render(createElement(CommandPalette, { items }));
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

for (const width of [375, 768, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`keyboard selection stays visible at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 812 });
      await page.route("http://fundflow.test/**", (route) => route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="en" data-theme="${theme}"><head><title>Command palette</title><style>${css}</style></head><body><main><h1>Navigation fixture</h1><button id="trigger">Open commands</button><div id="root"></div></main></body></html>`,
      }));
      await page.goto("http://fundflow.test/");
      await page.addScriptTag({ content: script });
      const trigger = page.getByRole("button", { name: "Open commands" });
      await trigger.focus();
      await page.keyboard.press("Control+k");
      const input = page.getByRole("combobox", { name: "Search commands" });
      await expect(input).toBeFocused();
      for (let i = 0; i < 25; i++) await input.press("ArrowDown");
      const selected = page.getByRole("option", { name: "Destination 25 Open destination 25", exact: true });
      await expect(selected).toHaveAttribute("aria-selected", "true");
      await expect.poll(async () => selected.evaluate((element) => {
        const row = element.getBoundingClientRect();
        const list = element.parentElement!.getBoundingClientRect();
        return row.top >= list.top && row.bottom <= list.bottom;
      })).toBe(true);
      await expect(input).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const results = await new AxeBuilder({ page }).include('dialog').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(results.violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`palette-${width}-${theme}.png`) });
      await input.press("Enter");
      await expect(page.locator("body")).toHaveAttribute("data-destination", "/destination/25");
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Control+k");
      await input.fill("no such destination");
      await input.press("ArrowDown");
      await expect(input).not.toHaveAttribute("aria-activedescendant");
      await input.fill("Destination 2");
      await input.press("Tab");
      await expect(input).toBeFocused();
      await input.press("Escape");
      await expect(trigger).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
}
