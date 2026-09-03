import { describe, it, expect } from "vitest";
import {
  TAX_CATEGORIES,
  TAX_FALLBACK_LINE_ITEM,
  normalizeTaxTag,
  resolveTaxLineItem,
} from "@/lib/tax-categories";

describe("normalizeTaxTag", () => {
  it("lowercases and strips punctuation and whitespace", () => {
    expect(normalizeTaxTag("  401(k) ")).toBe("401k");
    expect(normalizeTaxTag("W-2 Income")).toBe("w2income");
    expect(normalizeTaxTag("Child  Care")).toBe("childcare");
  });
});

describe("resolveTaxLineItem", () => {
  it("resolves curated aliases to their line item", () => {
    expect(resolveTaxLineItem(["Mortgage interest"])).toBe("Mortgage interest");
    expect(resolveTaxLineItem(["Donation", "vacation"])).toBe("Charitable donations");
    expect(resolveTaxLineItem(["vacation", "401(k)"])).toBe("Retirement contributions");
    expect(resolveTaxLineItem(["Health Care"])).toBe("Medical expenses");
  });

  it("matches aliases regardless of punctuation and case", () => {
    expect(resolveTaxLineItem(["W-2 income"])).toBe("W-2 income");
    expect(resolveTaxLineItem(["Student Loan"])).toBe("Student loan interest");
  });

  it("falls back for the legacy bare tax tag", () => {
    expect(resolveTaxLineItem(["tax"])).toBe(TAX_FALLBACK_LINE_ITEM);
  });

  it("curated categories win over the legacy tax tag", () => {
    expect(resolveTaxLineItem(["tax", "charity"])).toBe("Charitable donations");
  });

  it("first matching tag wins when several match", () => {
    expect(resolveTaxLineItem(["medical", "charity"])).toBe("Medical expenses");
    expect(resolveTaxLineItem(["charity", "medical"])).toBe("Charitable donations");
  });

  it("returns null when no tag is tax-relevant", () => {
    expect(resolveTaxLineItem([])).toBeNull();
    expect(resolveTaxLineItem(["vacation", "reimbursable"])).toBeNull();
  });

  it("every declared alias normalizes uniquely and resolves", () => {
    // Guard against a typo'd alias silently matching nothing (or another
    // category, which the index would resolve to the wrong line item).
    const seen = new Map<string, string>();
    for (const category of TAX_CATEGORIES) {
      for (const alias of category.aliases) {
        const normalized = normalizeTaxTag(alias);
        expect(seen.has(normalized), `duplicate alias: ${alias}`).toBe(false);
        seen.set(normalized, category.lineItem);
        expect(resolveTaxLineItem([alias])).toBe(category.lineItem);
      }
    }
  });
});
