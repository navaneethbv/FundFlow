/**
 * Colour palettes: ten for light mode and ten for dark mode, chosen
 * independently. The mode (`data-theme`) still decides light vs dark; the
 * palette decides the brand colour and the tint of the surfaces within it.
 *
 * What a palette may change is deliberately narrow: page background, raised
 * surfaces, borders, and the accent family. It never touches the `--viz-*`
 * chart slots or the success/danger/warning tokens. Those carry meaning
 * (money in vs out, over budget) and are validated against the panel colour
 * by `scripts/validate_palette.js`, so every palette's panel is held to the
 * contrast the default palette already clears (`tests/unit/themes.test.ts`).
 *
 * This module is the single source of truth: the CSS the root layout
 * injects, the Settings swatches, and the contrast tests all read it.
 */

import palettes from "./palettes.json";

export type ThemeMode = "light" | "dark";

export interface Palette {
  id: string;
  name: string;
  /** One line for the picker. */
  mood: string;
  background: string;
  panel: string;
  panel2: string;
  border: string;
  /** Accent used as text and focus rings: must read on `panel`. */
  accent: string;
  /** Loud accent for fills: primary buttons, active dots, the logo. */
  accentStrong: string;
  /** Second stop of the accent gradient. */
  accentStrong2: string;
  /** Text on an `accentStrong` fill. */
  onAccentStrong: string;
  /** Text on an `accent` fill. */
  onAccent: string;
  /** Selected row in Settings navigation. */
  settingsActive: string;
}

/** Palette values live in `palettes.json`; this module types and exposes them. */
export const LIGHT_PALETTES: readonly Palette[] = palettes.light;
export const DARK_PALETTES: readonly Palette[] = palettes.dark;

export const DEFAULT_PALETTE: Record<ThemeMode, string> = { light: "ember", dark: "ember" };

export function palettesFor(mode: ThemeMode): readonly Palette[] {
  return mode === "light" ? LIGHT_PALETTES : DARK_PALETTES;
}

export function isPaletteId(mode: ThemeMode, value: unknown): value is string {
  return typeof value === "string" && palettesFor(mode).some((palette) => palette.id === value);
}

/** `data-*` attribute on `<html>` that carries each mode's palette choice. */
export const PALETTE_ATTRIBUTE: Record<ThemeMode, string> = {
  light: "data-palette-light",
  dark: "data-palette-dark",
};

/** localStorage keys, read pre-paint by the root layout's inline script. */
export const PALETTE_STORAGE_KEY: Record<ThemeMode, string> = {
  light: "fundflow-palette-light",
  dark: "fundflow-palette-dark",
};

function declarations(palette: Palette): string {
  return [
    `--background:${palette.background}`,
    `--panel:${palette.panel}`,
    `--surface-strong:${palette.panel}`,
    `--sankey-surface:${palette.panel}`,
    `--panel-2:${palette.panel2}`,
    `--pill:${palette.panel2}`,
    `--panel-border:${palette.border}`,
    `--surface-border:${palette.border}`,
    `--sankey-border:${palette.border}`,
    `--accent:${palette.accent}`,
    `--accent-strong:${palette.accentStrong}`,
    `--accent-foreground:${palette.onAccent}`,
    `--accent-strong-foreground:${palette.onAccentStrong}`,
    `--accent-soft:color-mix(in srgb, ${palette.accent} 14%, transparent)`,
    `--accent-gradient:linear-gradient(135deg, ${palette.accentStrong}, ${palette.accentStrong2})`,
    `--shadow-glow:0 6px 18px color-mix(in srgb, ${palette.accentStrong} 38%, transparent)`,
    `--settings-active:${palette.settingsActive}`,
  ].join(";");
}

/**
 * The palette stylesheet. Default palettes emit nothing (globals.css already
 * holds those values). Each rule needs both the mode and the palette
 * attribute, so switching mode swaps to that mode's own choice.
 */
export function buildPaletteCss(): string {
  const rules: string[] = [];
  for (const mode of ["light", "dark"] as const) {
    for (const palette of palettesFor(mode)) {
      if (palette.id === DEFAULT_PALETTE[mode]) continue;
      rules.push(
        `:root[data-theme="${mode}"][${PALETTE_ATTRIBUTE[mode]}="${palette.id}"]{${declarations(palette)}}`,
      );
    }
  }
  return rules.join("\n");
}

/* ---- Contrast maths (WCAG 2.x), used by the tests and the picker ---- */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new RangeError(`not a #rrggbb colour: ${hex}`);
  const n = Number.parseInt(match[1]!, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
