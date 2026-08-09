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
  "#9f12a0",
  "#a457ef",
  "#2c94b0",
  "#8e5223",
  "#449546",
  "#544ec5",
  "#cb5790",
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
      expect.objectContaining({ mode: "tritanopia", pair: [3, 5] }),
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
});
