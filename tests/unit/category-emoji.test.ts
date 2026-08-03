import { describe, it, expect } from "vitest";
import { emojiForLabel } from "@/lib/category-emoji";

describe("emojiForLabel", () => {
  it("matches known labels case-insensitively", () => {
    expect(emojiForLabel("Shopping")).toBe("🛍️");
    expect(emojiForLabel("shopping")).toBe("🛍️");
    expect(emojiForLabel("SHOPPING")).toBe("🛍️");
  });

  it("ignores leading and trailing whitespace", () => {
    expect(emojiForLabel("  Groceries  ")).toBe("🛒");
  });

  it("returns an empty string for a label it does not recognise", () => {
    // Empty, not a placeholder glyph: a wrong emoji reads worse than none.
    expect(emojiForLabel("Some Brand New Plaid Category")).toBe("");
  });

  it("has an entry for every group visible in the reference diagram", () => {
    for (const label of [
      "Shopping",
      "Financial",
      "Travel & Lifestyle",
      "Food & Dining",
      "Housing",
      "Health & Wellness",
      "Auto & Transport",
    ]) {
      expect(emojiForLabel(label)).not.toBe("");
    }
  });
});
