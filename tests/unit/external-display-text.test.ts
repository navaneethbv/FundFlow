import { describe, expect, it } from "vitest";
import { normalizeExternalDisplayText } from "@/lib/external-display-text";

describe("normalizeExternalDisplayText", () => {
  it("cleans replacement characters and collapses whitespace", () => {
    // Reproduces the replacement-character shape using a synthetic label.
    expect(
      normalizeExternalDisplayText("EXAMPLE BANK REWARDS\uFFFD\uFFFD CARD"),
    ).toBe("EXAMPLE BANK REWARDS CARD");
  });

  it("preserves valid trademark and registered symbols", () => {
    expect(normalizeExternalDisplayText("VISA® CARD")).toBe("VISA® CARD");
    expect(normalizeExternalDisplayText("Apple™ Card")).toBe("Apple™ Card");
  });

  it("preserves accents and non-Latin scripts", () => {
    expect(normalizeExternalDisplayText("Café Nestlé")).toBe("Café Nestlé");
    expect(normalizeExternalDisplayText("三菱UFJ銀行")).toBe("三菱UFJ銀行");
  });

  it("handles whitespace, empty strings, and null/undefined", () => {
    expect(normalizeExternalDisplayText("   ")).toBeNull();
    expect(normalizeExternalDisplayText("\uFFFD\uFFFD")).toBeNull();
    expect(normalizeExternalDisplayText(null)).toBeNull();
    expect(normalizeExternalDisplayText(undefined)).toBeNull();
  });
});
