import { describe, expect, it } from "vitest";
import paletteValidator from "@/scripts/validate_palette.js";

const {
  deltaEOklab,
  hexToRgb,
  simulateCvd,
  validatePalette,
} = paletteValidator;

const LIGHT = [
  "#2a78d6",
  "#1baf7a",
  "#eda100",
  "#008300",
  "#4a3aa7",
  "#e34948",
  "#c2379a",
];

const DARK = [
  "#77a9ea",
  "#55c795",
  "#f1a824",
  "#299525",
  "#755efd",
  "#d57c75",
  "#d33ea7",
];

describe("palette validator", () => {
  it("rejects malformed hexadecimal colors", () => {
    expect(() => hexToRgb("#12345")).toThrow("invalid_hex_color");
    expect(() => hexToRgb("blue")).toThrow("invalid_hex_color");
  });

  it("reproduces the canonical OKLab normal and protanopia distances", () => {
    expect(deltaEOklab("#9085e9", "#3987e5")).toBeCloseTo(9.8, 1);
    expect(deltaEOklab("#9085e9", "#3987e5", "protanopia")).toBeCloseTo(1.9, 1);
  });

  it.each(["protanopia", "deuteranopia", "tritanopia"] as const)(
    "simulates %s without producing out-of-range channels",
    (mode) => {
      const result = simulateCvd(hexToRgb("#ff6b2e"), mode);
      expect(Object.values(result).every((channel) => channel >= 0 && channel <= 1)).toBe(true);
      expect(result).not.toEqual(hexToRgb("#ff6b2e"));
    },
  );

  it("accepts the approved light and dark categorical palettes", () => {
    expect(validatePalette("light", LIGHT)).toMatchObject({ valid: true, failures: [] });
    expect(validatePalette("dark", DARK)).toMatchObject({ valid: true, failures: [] });
    expect(validatePalette("dark", DARK).warnings).toContainEqual(
      expect.objectContaining({ mode: "tritanopia", pair: [1, 2] }),
    );
  });

  it("holds every dark slot above the 3:1 non-text contrast floor", () => {
    // Pairwise separation does not imply visibility on the panel: the
    // 2026-08-09 re-step separated cleanly and still put three slots under 3:1.
    const surfaceFailures = validatePalette("dark", DARK).failures.filter(
      (failure: { mode: string }) => failure.mode === "surface",
    );
    expect(surfaceFailures).toEqual([]);
  });

  it("fails a dark slot that disappears into the panel", () => {
    const sunk = [...DARK];
    sunk[0] = "#2b2b2a"; // barely off the #222221 panel
    const result = validatePalette("dark", sunk);

    expect(result.valid).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ theme: "dark", mode: "surface", pair: [1, 1], floor: 3 }),
    );
  });

  it("carries the two known light-mode exceptions as warnings, not failures", () => {
    const result = validatePalette("light", LIGHT);

    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ theme: "light", mode: "surface", pair: [3, 3] }),
    );
  });

  it("reports every failed pair with theme, mode, pair, distance, and floor", () => {
    const result = validatePalette("dark", ["#111111", "#111111", "#ffffff"]);

    expect(result.valid).toBe(false);
    expect(result.failures).toContainEqual({
      theme: "dark",
      mode: "normal",
      pair: [1, 2],
      distance: 0,
      floor: 15,
    });
    expect(result.failures).toContainEqual({
      theme: "dark",
      mode: "protanopia",
      pair: [1, 2],
      distance: 0,
      floor: 6,
    });
  });

  it("throws error for invalid CVD mode", () => {
    expect(() => simulateCvd(hexToRgb("#ffffff"), "unknown")).toThrow("invalid_cvd_mode");
  });

  it("parses palettes from CSS source code", () => {
    const css = `
      :root {
        --viz-1: #2a78d6;
        --viz-2: #1baf7a;
        --viz-3: #eda100;
        --viz-4: #008300;
        --viz-5: #4a3aa7;
        --viz-6: #e34948;
        --viz-7: #c2379a;
      }
      :root[data-theme="dark"] {
        --viz-1: #77a9ea;
        --viz-2: #55c795;
        --viz-3: #f1a824;
        --viz-4: #299525;
        --viz-5: #755efd;
        --viz-6: #d57c75;
        --viz-7: #d33ea7;
      }
    `;
    const palettes = paletteValidator.palettesFromCss(css) as Record<
      string,
      string[]
    >;
    expect(palettes.light).toHaveLength(7);
    expect(palettes.dark).toHaveLength(7);
  });

  it("handles dark sRGB values below 0.04045 linear threshold", () => {
    const result = simulateCvd(hexToRgb("#010203"), "protanopia");
    expect(result).toBeDefined();
  });

  it("runs CLI validation on app/globals.css", async () => {
    const exitCode = await paletteValidator.runCli("app/globals.css");
    expect(exitCode).toBe(0);
  });

  it("returns exit code 1 when CSS missing expected palettes", async () => {
    const exitCode = await paletteValidator.runCli("package.json");
    expect(exitCode).toBe(1);
  });

  it("returns exit code 1 and logs failures when CSS has palette failures", async () => {
    const fs = await import("node:fs/promises");
    const badCss = `
      :root {
        --viz-1: #ffffff;
        --viz-2: #ffffff;
        --viz-3: #ffffff;
        --viz-4: #ffffff;
        --viz-5: #ffffff;
        --viz-6: #ffffff;
        --viz-7: #ffffff;
      }
      :root[data-theme="dark"] {
        --viz-1: #000000;
        --viz-2: #000000;
        --viz-3: #000000;
        --viz-4: #000000;
        --viz-5: #000000;
        --viz-6: #000000;
        --viz-7: #000000;
      }
    `;
    const tempFile = "coverage/temp-bad-palette.css";
    await fs.mkdir("coverage", { recursive: true });
    await fs.writeFile(tempFile, badCss, "utf8");
    try {
      const exitCode = await paletteValidator.runCli(tempFile);
      expect(exitCode).toBe(1);
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }
  });

  it("handles unknown theme in validatePalette", () => {
    const res = validatePalette("custom", LIGHT);
    expect(res).toBeDefined();
    expect(res.valid).toBe(true);
  });
});
