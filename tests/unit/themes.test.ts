import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPaletteCss,
  contrastRatio,
  DARK_PALETTES,
  DEFAULT_PALETTE,
  isPaletteId,
  LIGHT_PALETTES,
  type Palette,
  type ThemeMode,
} from "@/lib/themes";

/**
 * Every palette is held to the contrast the default palette already clears.
 * The `--viz-*` chart slots and the semantic success/danger/warning tokens
 * are shared by all palettes, so they are read from globals.css (the
 * validated source) rather than restated here.
 */
const css = readFileSync("app/globals.css", "utf8");

function tokensFor(mode: ThemeMode): Record<string, string> {
  const block = new RegExp(`:root\\[data-theme="${mode}"\\] \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? "";
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens[match[1]!] = match[2]!;
  }
  return tokens;
}

const MODES: Array<[ThemeMode, readonly Palette[]]> = [
  ["light", LIGHT_PALETTES],
  ["dark", DARK_PALETTES],
];
const CHART_SLOTS = ["viz-1", "viz-2", "viz-3", "viz-4", "viz-5", "viz-6", "viz-7", "viz-pos", "viz-neg"];
const TEXT_TOKENS = ["foreground", "muted", "success", "danger", "warning"];

describe("colour palettes", () => {
  it("offers ten palettes per mode with unique ids and the default first", () => {
    for (const [mode, palettes] of MODES) {
      expect(palettes, mode).toHaveLength(10);
      expect(new Set(palettes.map((p) => p.id)).size, mode).toBe(10);
      expect(palettes[0]!.id, mode).toBe(DEFAULT_PALETTE[mode]);
    }
  });

  it("keeps the default palette identical to the globals.css tokens", () => {
    for (const [mode, palettes] of MODES) {
      const tokens = tokensFor(mode);
      const base = palettes[0]!;
      expect(base.background, mode).toBe(tokens.background);
      expect(base.panel, mode).toBe(tokens.panel);
      expect(base.accent, mode).toBe(tokens.accent);
      expect(base.accentStrong, mode).toBe(tokens["accent-strong"]);
    }
  });

  it.each(MODES)("keeps %s accent, button, and body text readable (WCAG AA)", (mode, palettes) => {
    const tokens = tokensFor(mode);
    for (const p of palettes) {
      expect(contrastRatio(p.accent, p.panel), `${p.id} accent on panel`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.accent, p.background), `${p.id} accent on background`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.onAccent, p.accent), `${p.id} text on accent`).toBeGreaterThanOrEqual(4.5);
      // Primary-button text sits across the whole gradient, so both stops count.
      for (const stop of [p.accentStrong, p.accentStrong2]) {
        expect(contrastRatio(p.onAccentStrong, stop), `${p.id} button text on ${stop}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const token of TEXT_TOKENS) {
        for (const surface of [p.panel, p.panel2, p.background]) {
          expect(contrastRatio(tokens[token]!, surface), `${p.id} ${token} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it.each(MODES)("never weakens %s chart contrast against the panel", (mode, palettes) => {
    const tokens = tokensFor(mode);
    const basePanel = palettes[0]!.panel;
    for (const p of palettes) {
      for (const slot of CHART_SLOTS) {
        const colour = tokens[slot]!;
        // A slot already under 3:1 on the default panel (light aqua/yellow,
        // which ship direct labels instead) may not get worse; every other
        // slot must stay at 3:1 or better (WCAG 1.4.11 non-text contrast).
        const floor = Math.min(3, contrastRatio(colour, basePanel)) - 0.01;
        expect(contrastRatio(colour, p.panel), `${p.id} ${slot}`).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it("scopes every rule to both the mode and that mode's palette attribute", () => {
    const rules = buildPaletteCss().split("\n");
    expect(rules).toHaveLength(18);
    for (const rule of rules) {
      expect(rule).toMatch(/^:root\[data-theme="(light|dark)"\]\[data-palette-(light|dark)="[a-z]+"\]\{/);
      const [, mode, attrMode] = /data-theme="(\w+)"\]\[data-palette-(\w+)=/.exec(rule)!;
      expect(attrMode).toBe(mode);
      expect(rule).not.toContain("--viz-");
    }
  });

  it("validates ids per mode", () => {
    expect(isPaletteId("light", "ocean")).toBe(true);
    expect(isPaletteId("dark", "ocean")).toBe(false);
    expect(isPaletteId("dark", "midnight")).toBe(true);
    expect(isPaletteId("light", "<script>")).toBe(false);
  });
});
