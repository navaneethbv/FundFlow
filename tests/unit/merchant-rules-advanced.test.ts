import { describe, it, expect } from "vitest";
import { applyMerchantRules, previewMerchantRules, type MerchantRule } from "@/lib/planning";

describe("Enhanced Merchant Rules Engine", () => {
  it("matches by regex pattern", () => {
    const rules: MerchantRule[] = [
      {
        matchType: "regex",
        pattern: "^Uber(\\s*Eats)?$",
        displayName: "Uber Services",
        category: "TRANSPORTATION",
        enabled: true,
      },
    ];

    const txns = [
      { id: "1", merchant: "Uber", category: "GENERAL" },
      { id: "2", merchant: "Uber Eats", category: "FOOD" },
      { id: "3", merchant: "Not Uber", category: "GENERAL" },
    ];

    const result = applyMerchantRules(txns, rules);
    expect(result[0]?.merchant).toBe("Uber Services");
    expect(result[0]?.category).toBe("TRANSPORTATION");
    expect(result[1]?.merchant).toBe("Uber Services");
    expect(result[2]?.merchant).toBe("Not Uber");
  });

  it("filters by min and max amount bounds", () => {
    const rules: MerchantRule[] = [
      {
        matchType: "keyword",
        pattern: "Amazon",
        minAmount: 100,
        displayName: "Amazon Large Purchase",
        category: "ELECTRONICS",
        enabled: true,
      },
      {
        matchType: "keyword",
        pattern: "Amazon",
        maxAmount: 99.99,
        displayName: "Amazon Everyday",
        category: "SHOPPING",
        enabled: true,
      },
    ];

    const txns = [
      { id: "1", merchant: "Amazon.com", category: "GENERAL", amount: 150 },
      { id: "2", merchant: "Amazon.com", category: "GENERAL", amount: 25 },
    ];

    const result = applyMerchantRules(txns, rules);
    expect(result[0]?.merchant).toBe("Amazon Large Purchase");
    expect(result[0]?.category).toBe("ELECTRONICS");
    expect(result[1]?.merchant).toBe("Amazon Everyday");
    expect(result[1]?.category).toBe("SHOPPING");
  });

  it("applies tags when configured in the rule", () => {
    const rules: MerchantRule[] = [
      {
        matchType: "keyword",
        pattern: "Delta",
        displayName: "Delta Airlines",
        category: "TRAVEL",
        tags: ["flight", "vacation"],
        enabled: true,
      },
    ];

    const txns = [
      { id: "1", merchant: "Delta Air Lines", category: "GENERAL", tags: ["business"] },
    ];

    const result = applyMerchantRules(txns, rules);
    expect(result[0]?.merchant).toBe("Delta Airlines");
    expect(result[0]?.tags).toEqual(["business", "flight", "vacation"]);
  });

  it("safely ignores invalid regex without throwing", () => {
    const rules: MerchantRule[] = [
      {
        matchType: "regex",
        pattern: "[invalid(regex",
        displayName: "Broken",
        enabled: true,
      },
    ];

    const txns = [{ id: "1", merchant: "Any Store", category: "GENERAL" }];
    const result = applyMerchantRules(txns, rules);
    expect(result[0]?.merchant).toBe("Any Store");
  });

  it("previews rule changes accurately", () => {
    const rules: MerchantRule[] = [
      {
        matchType: "keyword",
        pattern: "Starbucks",
        displayName: "Coffee & Cafe",
        category: "FOOD_AND_DRINK",
        enabled: true,
      },
    ];

    const txns = [
      { id: "1", merchant: "Starbucks Store #1234", category: "GENERAL" },
      { id: "2", merchant: "Target", category: "GENERAL" },
    ];

    const previews = previewMerchantRules(txns, rules);
    expect(previews).toHaveLength(1);
    expect(previews[0]?.transactionId).toBe("1");
    expect(previews[0]?.after.merchant).toBe("Coffee & Cafe");
    expect(previews[0]?.after.category).toBe("FOOD_AND_DRINK");
  });
});
