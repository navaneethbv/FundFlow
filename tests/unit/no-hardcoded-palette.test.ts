import { readdirSync, readFileSync, statSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Panel from "@/components/ui/Panel";

/**
 * Token migration (frontend-review R9):
 * Components and routes must use semantic tokens (--danger, --success, --warning, --accent, etc.)
 * rather than hardcoded Tailwind palette colors (text-red-600, bg-amber-500, etc.).
 */

const HARDCODED_COLOR_REGEX = /\b(text|bg|border)-(red|green|amber|emerald|blue|orange|yellow|rose|lime|sky)-\d{2,3}\b/;

function findOffenders(dir: string): string[] {
  const offenders: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("_")) continue;
      offenders.push(...findOffenders(full));
    } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
      const source = readFileSync(full, "utf8");
      if (HARDCODED_COLOR_REGEX.test(source)) {
        offenders.push(full);
      }
    }
  }
  return offenders;
}

describe("semantic token discipline (no hardcoded palette colors)", () => {
  it("Panel warning tone uses semantic warning tokens", () => {
    const html = renderToStaticMarkup(
      createElement(Panel, { tone: "warning" }, "Warning contents"),
    );
    expect(html).toContain("border-warning");
    expect(html).toContain("bg-warning");
    expect(html).not.toContain("amber-500");
  });

  it("no components contain hardcoded Tailwind color literals", () => {
    const offenders = findOffenders("components");
    expect(
      offenders,
      `components must use semantic tokens instead of hardcoded colors: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("no app routes contain hardcoded Tailwind color literals", () => {
    const offenders = findOffenders("app");
    expect(
      offenders,
      `app routes must use semantic tokens instead of hardcoded colors: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
