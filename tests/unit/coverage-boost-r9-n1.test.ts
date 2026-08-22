import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import paletteValidator from "@/scripts/validate_palette.js";

const { deltaEOklab, hexToRgb, palettesFromCss, runCli, simulateCvd, validatePalette } =
  paletteValidator;

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

// Protanopia distance of #2a78d6 vs #ff00ff is 6.37, inside [6, 8).
const CVD_WARN = ["#2a78d6", "#ff00ff", "#eda100", "#008300", "#4a3aa7", "#e34948", "#c2379a"];

const APPROVED_CSS = `
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

const FAILING_CSS = `
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

async function withTempCss(source: string, fn: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "r9-palette-"));
  const path = join(dir, "palette.css");
  await writeFile(path, source, "utf8");
  try {
    await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("coverage boost r9: validate_palette", () => {
  it("rejects non-string hex inputs (B@56 non-string side)", () => {
    expect(() => hexToRgb(123 as unknown as string)).toThrow("invalid_hex_color");
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#0a0b0c")).toEqual({ r: 10, g: 11, b: 12 });
  });

  it("drives both sides of the sRGB linearization threshold (B@68)", () => {
    // 1/255 = 0.0039 <= 0.04045 -> linear branch; 255/255 = 1 -> power branch.
    const dim = simulateCvd(hexToRgb("#010203"), "protanopia");
    const bright = simulateCvd(hexToRgb("#ffffff"), "protanopia");
    expect(Object.values(dim).every((c) => c >= 0 && c <= 1)).toBe(true);
    expect(Object.values(bright).every((c) => c >= 0 && c <= 1)).toBe(true);
    expect(dim.r).toBeLessThan(bright.r);
  });

  it("throws for an unknown CVD mode and accepts known modes (B@84)", () => {
    expect(() => simulateCvd(hexToRgb("#ff6b2e"), "not-a-mode")).toThrow("invalid_cvd_mode");
    for (const mode of ["protanopia", "deuteranopia", "tritanopia"]) {
      expect(simulateCvd(hexToRgb("#ff6b2e"), mode)).toBeDefined();
    }
  });

  it("drives both the simulated and unsimulated ΔE paths (B@115, B@118)", () => {
    const plain = deltaEOklab("#9085e9", "#3987e5");
    const simulated = deltaEOklab("#9085e9", "#3987e5", "protanopia");
    expect(plain).toBeGreaterThan(0);
    expect(simulated).toBeGreaterThan(0);
    expect(simulated).toBeLessThan(plain);
  });

  it("handles a theme with no defined surface (B@159 false, B@160 RHS)", () => {
    const result = validatePalette("custom", LIGHT);
    expect(result.valid).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("warns for known exempt surface slots and fails non-exempt ones (B@160 LHS, B@164, B@172)", () => {
    const light = validatePalette("light", LIGHT);
    expect(light.warnings).toContainEqual(
      expect.objectContaining({ theme: "light", mode: "surface", pair: [3, 3] }),
    );
    expect(light.failures).not.toContainEqual(
      expect.objectContaining({ mode: "surface" }),
    );

    const sunkLight = [...LIGHT];
    sunkLight[6] = "#ffffff"; // slot 7, not in the light exemption set
    const sunk = validatePalette("light", sunkLight);
    expect(sunk.valid).toBe(false);
    expect(sunk.failures).toContainEqual(
      expect.objectContaining({ theme: "light", mode: "surface", pair: [7, 7] }),
    );
  });

  it("reports normal-pair failures below the floor and skips those above (B@177)", () => {
    const near = validatePalette("light", ["#111111", "#111111", "#ffffff"]);
    expect(near.failures).toContainEqual(
      expect.objectContaining({ mode: "normal", pair: [1, 2], floor: 15 }),
    );

    const clear = validatePalette("light", LIGHT);
    expect(clear.failures).not.toContainEqual(expect.objectContaining({ mode: "normal" }));
  });

  it("drives both sides of the protanopia/deuteranopia severity split (B@189, B@191)", () => {
    const severe = validatePalette("light", ["#ffffff", "#ffffff", "#ffffff"]);
    expect(severe.failures).toContainEqual(
      expect.objectContaining({ mode: "protanopia", pair: [1, 2], floor: 6 }),
    );

    const warn = validatePalette("light", CVD_WARN);
    expect(warn.warnings).toContainEqual(
      expect.objectContaining({ mode: "protanopia", pair: [1, 2], floor: 8 }),
    );

    // DARK has no protanopia pair below 8, so every pair falls through the else-if.
    const clear = validatePalette("dark", DARK);
    expect(clear.warnings).not.toContainEqual(expect.objectContaining({ mode: "protanopia" }));
  });

  it("drives both sides of the tritanopia warning threshold (B@197)", () => {
    const warn = validatePalette("light", LIGHT);
    expect(warn.warnings).toContainEqual(
      expect.objectContaining({ mode: "tritanopia", pair: [1, 4], floor: 8 }),
    );

    // An orange/green-only palette keeps every tritanopia pair at or above 8.
    const clear = validatePalette("light", ["#ff6b2e", "#1baf7a", "#2a78d6", "#eda100"]);
    expect(clear.warnings).not.toContainEqual(expect.objectContaining({ mode: "tritanopia" }));
  });

  it("parses both theme blocks and skips partial blocks (B@214, B@218, B@221)", () => {
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
      }
    `;
    const palettes: { light?: string[]; dark?: string[] } = palettesFromCss(css);
    expect(palettes).toEqual({
      light: LIGHT.map((c) => c.toLowerCase()),
    });
    expect(palettes.dark).toBeUndefined();
  });

  it("parses an explicit dark theme block into its own palette (B@214 explicit)", () => {
    const palettes: { light?: string[]; dark?: string[] } = palettesFromCss(APPROVED_CSS);
    expect(palettes.light).toHaveLength(7);
    expect(palettes.dark).toEqual(DARK.map((c) => c.toLowerCase()));
  });

  it("runs the CLI over approved palettes and exits 0 (B@229 false, B@240, B@245 false)", async () => {
    await withTempCss(APPROVED_CSS, async (path) => {
      const logs: string[] = [];
      const originalWarn = console.warn;
      const originalLog = console.log;
      console.warn = (msg: string) => logs.push(String(msg));
      console.log = () => {};
      try {
        const exitCode = await runCli(path);
        expect(exitCode).toBe(0);
        expect(logs.some((line) => line.includes("surface-contrast"))).toBe(true);
        expect(logs.some((line) => line.includes("tritanopia"))).toBe(true);
      } finally {
        console.warn = originalWarn;
        console.log = originalLog;
      }
    });
  });

  it("runs the CLI over a failing palette, logs, and exits 1 (B@245 true, B@248)", async () => {
    await withTempCss(FAILING_CSS, async (path) => {
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (msg: string) => errors.push(String(msg));
      try {
        const exitCode = await runCli(path);
        expect(exitCode).toBe(1);
        expect(errors.some((line) => line.includes("surface-contrast"))).toBe(true);
        expect(errors.some((line) => line.includes(" normal viz-"))).toBe(true);
      } finally {
        console.error = originalError;
      }
    });
  });

  it("returns exit code 1 when fewer than two palettes exist (B@229 true)", async () => {
    const css = `
      :root {
        --viz-1: #2a78d6;
      }
    `;
    await withTempCss(css, async (path) => {
      const originalError = console.error;
      console.error = () => {};
      try {
        expect(await runCli(path)).toBe(1);
      } finally {
        console.error = originalError;
      }
    });
  });

  });