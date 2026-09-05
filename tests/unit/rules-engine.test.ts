import { describe, it, expect } from "vitest";
import {
  evaluateRule,
  applyRulesToTransaction,
  simulateRulesBatch,
  matchesAmountCondition,
  safeCompileRegex,
  type SmartRule,
  type RuleTransactionCandidate,
  type AmountOperator,
  type RuleMatchType,
} from "@/lib/rules-engine";

describe("Smart Rules Engine: Amount Condition Matching", () => {
  it("matches 'any' or undefined condition", () => {
    expect(matchesAmountCondition(50, undefined)).toBe(true);
    expect(matchesAmountCondition(50, null)).toBe(true);
    expect(matchesAmountCondition(50, { operator: "any" })).toBe(true);
    expect(matchesAmountCondition(50, { operator: "unknown" as AmountOperator })).toBe(true);
  });

  it("evaluates 'gt' and 'gte'", () => {
    expect(matchesAmountCondition(100, { operator: "gt", value: 50 })).toBe(true);
    expect(matchesAmountCondition(50, { operator: "gt", value: 50 })).toBe(false);
    expect(matchesAmountCondition(-100, { operator: "gt", value: 50 })).toBe(true); // abs(amount)

    expect(matchesAmountCondition(50, { operator: "gte", value: 50 })).toBe(true);
    expect(matchesAmountCondition(49.99, { operator: "gte", value: 50 })).toBe(false);
  });

  it("evaluates 'lt' and 'lte'", () => {
    expect(matchesAmountCondition(25, { operator: "lt", value: 50 })).toBe(true);
    expect(matchesAmountCondition(50, { operator: "lt", value: 50 })).toBe(false);

    expect(matchesAmountCondition(50, { operator: "lte", value: 50 })).toBe(true);
    expect(matchesAmountCondition(51, { operator: "lte", value: 50 })).toBe(false);
  });

  it("evaluates 'between'", () => {
    expect(matchesAmountCondition(50, { operator: "between", value: 20, maxValue: 100 })).toBe(true);
    expect(matchesAmountCondition(15, { operator: "between", value: 20, maxValue: 100 })).toBe(false);
    expect(matchesAmountCondition(120, { operator: "between", value: 20, maxValue: 100 })).toBe(false);

    // between when maxValue is omitted (defaults to val)
    expect(matchesAmountCondition(50, { operator: "between", value: 50 })).toBe(true);
    expect(matchesAmountCondition(51, { operator: "between", value: 50 })).toBe(false);
  });
});

describe("Smart Rules Engine: Rule Evaluation", () => {
  const sampleTx: RuleTransactionCandidate = {
    id: "tx-1",
    merchant: "Starbucks Coffee #1234",
    name: "POS DEBIT STARBUCKS",
    accountName: "Primary Checking",
    amount: -5.75,
    category: "FOOD_AND_DRINK",
    tags: ["dining"],
  };

  it("skips disabled rules or empty patterns", () => {
    const disabledRule: SmartRule = {
      id: "r1",
      matchType: "keyword",
      pattern: "Starbucks",
      enabled: false,
    };
    expect(evaluateRule(disabledRule, sampleTx)).toBe(false);

    const emptyPatternRule: SmartRule = {
      id: "r-empty",
      matchType: "keyword",
      pattern: "   ",
      enabled: true,
    };
    expect(evaluateRule(emptyPatternRule, sampleTx)).toBe(false);
  });

  it("fails evaluation if amount condition does not match", () => {
    const rule: SmartRule = {
      id: "r-amt",
      matchType: "keyword",
      pattern: "Starbucks",
      amountCondition: { operator: "gt", value: 100 },
      enabled: true,
    };
    expect(evaluateRule(rule, sampleTx)).toBe(false);
  });

  it("evaluates keyword match", () => {
    const rule: SmartRule = {
      id: "r1",
      matchType: "keyword",
      pattern: "debit starbucks",
      enabled: true,
    };
    expect(evaluateRule(rule, sampleTx)).toBe(true);
  });

  it("evaluates merchant match on merchant and name fallback", () => {
    const rule: SmartRule = {
      id: "r2",
      matchType: "merchant",
      pattern: "Starbucks Coffee",
      enabled: true,
    };
    expect(evaluateRule(rule, sampleTx)).toBe(true);

    const txNoMerchant: RuleTransactionCandidate = {
      id: "tx-2",
      name: "Dunkin Donuts POS",
      amount: 4.5,
    };
    const ruleDunkin: SmartRule = {
      id: "r-dunkin",
      matchType: "merchant",
      pattern: "Dunkin",
      enabled: true,
    };
    expect(evaluateRule(ruleDunkin, txNoMerchant)).toBe(true);
  });

  it("evaluates account match", () => {
    const rule: SmartRule = {
      id: "r3",
      matchType: "account",
      pattern: "Checking",
      enabled: true,
    };
    expect(evaluateRule(rule, sampleTx)).toBe(true);
  });

  it("evaluates regex match and safely catches invalid regex", () => {
    const validRegexRule: SmartRule = {
      id: "r4",
      matchType: "regex",
      pattern: "^(Starbucks|Dunkin)",
      enabled: true,
    };
    expect(evaluateRule(validRegexRule, sampleTx)).toBe(true);

    const invalidRegexRule: SmartRule = {
      id: "r5",
      matchType: "regex",
      pattern: "[invalid(regex",
      enabled: true,
    };
    expect(evaluateRule(invalidRegexRule, sampleTx)).toBe(false);

    // ReDoS protection against nested quantifiers
    const nestedQuantifierPattern = ["(", "a", "+", ")", "+", "$"].join("");
    const redosRule: SmartRule = {
      id: "r-redos",
      matchType: "regex",
      pattern: nestedQuantifierPattern,
      enabled: true,
    };
    expect(evaluateRule(redosRule, sampleTx)).toBe(false);

    // Precompiled regex support
    const precompiledRule: SmartRule = {
      id: "r-precompiled",
      matchType: "regex",
      pattern: "ignored",
      compiledRegex: /^Starbucks/i,
      enabled: true,
    };
    expect(evaluateRule(precompiledRule, sampleTx)).toBe(true);
  });

  it("safeCompileRegex guards against ReDoS vulnerabilities and length overflow", () => {
    expect(safeCompileRegex("")).toBeNull();
    expect(safeCompileRegex("   ")).toBeNull();
    expect(safeCompileRegex("a".repeat(150))).toBeNull(); // exceeds MAX_REGEX_PATTERN_LENGTH
    expect(safeCompileRegex(["(", "a", "+", ")", "+"].join(""))).toBeNull(); // nested +
    expect(safeCompileRegex(["(", "a", "*", ")", "*"].join(""))).toBeNull(); // nested *
    expect(safeCompileRegex(["(", "a", "+", ")", "{2,}"].join(""))).toBeNull(); // nested range
    expect(safeCompileRegex(["([a-z]+)", "{2,5}"].join(""))).toBeNull(); // nested range
    expect(safeCompileRegex(["(", "a", ")", "\\", "1"].join(""))).toBeNull(); // backreference \1
    expect(safeCompileRegex(["(", "a", "|", "a", "a", ")", "+"].join(""))).toBeNull(); // overlapping alternatives
    expect(safeCompileRegex(["(", "?:", "a", "+", ")", "+"].join(""))).toBeNull(); // non-capturing nested +
    expect(safeCompileRegex(["(", "(", "a", "+", ")", ")", "+"].join(""))).toBeNull(); // deeply nested +
    expect(safeCompileRegex(["(", "(", "a", "|", "b", ")", ")", "+"].join(""))).toBeNull(); // nested alternation with quantifier
    expect(safeCompileRegex(["^", "(", "a", "?", "a", "?", ")", "+", "$"].join(""))).toBeNull(); // nested optional quantifiers
    expect(safeCompileRegex(["(", "a", "?", ")", "+"].join(""))).toBeNull(); // nested optional inside loop quantifier
    expect(safeCompileRegex("[incomplete")).toBeNull(); // invalid syntax

    // A quantified group with a plain literal body stays allowed, as does a
    // quantified group elsewhere in the pattern with an unambiguous body.
    expect(safeCompileRegex("(foo)+")).toBeInstanceOf(RegExp);
    expect(safeCompileRegex("(?:bar)+x")).toBeInstanceOf(RegExp);
    expect(safeCompileRegex("(foo\\+bar)+")).toBeInstanceOf(RegExp);
    expect(safeCompileRegex("a".repeat(251))).toBeNull();

    const valid = safeCompileRegex("^[a-z0-9_-]+$");
    expect(valid).toBeInstanceOf(RegExp);
  });

  it("returns false for unknown match types", () => {
    const rule: SmartRule = {
      id: "r-unknown",
      matchType: "unknown" as RuleMatchType,
      pattern: "test",
      enabled: true,
    };
    expect(evaluateRule(rule, sampleTx)).toBe(false);
  });
});

describe("Smart Rules Engine: Application & Batch Simulation", () => {
  const rules: SmartRule[] = [
    {
      id: "rule-amzn",
      matchType: "regex",
      pattern: "^(AMZN|Amazon)",
      displayName: "Amazon",
      category: "SHOPPING",
      tags: ["online", "household", "  "],
      enabled: true,
    },
    {
      id: "rule-sbux",
      matchType: "keyword",
      pattern: "Starbucks",
      displayName: "Starbucks",
      category: "COFFEE",
      tags: ["coffee"],
      enabled: true,
    },
    {
      id: "rule-keep-same",
      matchType: "keyword",
      pattern: "Gas",
      // display_name and category omitted
      enabled: true,
    },
  ];

  const transactions: RuleTransactionCandidate[] = [
    {
      id: "tx-1",
      merchant: "AMZN Mktp US*123",
      amount: -45.0,
      category: "GENERAL_MERCHANDISE",
      tags: ["supplies"],
    },
    {
      id: "tx-2",
      merchant: "Starbucks Store #999",
      amount: -6.5,
      category: "FOOD_AND_DRINK",
      tags: [],
    },
    {
      id: "tx-3",
      merchant: "Gas Station",
      amount: -55.0,
      category: "GAS",
      tags: [],
    },
    {
      id: "tx-4",
      merchant: "Other Store",
      amount: -10.0,
    },
  ];

  it("transforms matched transactions and preserves tags without duplicates", () => {
    const result = applyRulesToTransaction(rules, transactions[0]!);
    expect(result.modified).toBe(true);
    expect(result.matchedRuleId).toBe("rule-amzn");
    expect(result.updated.merchant).toBe("Amazon");
    expect(result.updated.category).toBe("SHOPPING");
    expect(result.updated.tags).toContain("supplies");
    expect(result.updated.tags).toContain("online");
    expect(result.updated.tags).toContain("household");
  });

  it("handles rule matching that keeps existing merchant and category when omitted in rule", () => {
    const result = applyRulesToTransaction([rules[2]!], transactions[2]!);
    // Gas Station matches "Gas", but rule has no displayName, category, or tags
    expect(result.matchedRuleId).toBe("rule-keep-same");
    expect(result.modified).toBe(false);
  });

  it("leaves unmatched transactions unmodified", () => {
    const result = applyRulesToTransaction(rules, transactions[3]!);
    expect(result.modified).toBe(false);
    expect(result.matchedRuleId).toBeNull();
    expect(result.updated.merchant).toBe("Other Store");
  });

  it("detects tag changes even when tag count remains the same", () => {
    const swapRule: SmartRule = {
      id: "rule-swap",
      matchType: "keyword",
      pattern: "Gas",
      tags: ["fuel"],
      enabled: true,
    };
    const txWithTag: RuleTransactionCandidate = {
      id: "tx-tagged",
      merchant: "Gas Station",
      amount: -50,
      tags: ["gas"],
    };
    const result = applyRulesToTransaction([swapRule], txWithTag);
    expect(result.modified).toBe(true);
    expect(result.updated.tags).toEqual(["gas", "fuel"]);
  });

  it("simulates batch processing accurately", () => {
    const batch = simulateRulesBatch(rules, transactions);
    expect(batch.totalEvaluated).toBe(4);
    expect(batch.matchedCount).toBe(3);
    expect(batch.modifiedCount).toBe(2);
    expect(batch.results).toHaveLength(4);
  });

  it("handles missing pattern on rule and empty candidate merchant safely", () => {
    const noPatternRule = {
      id: "r-no-pattern",
      matchType: "keyword",
      enabled: true,
    } as unknown as SmartRule;
    expect(evaluateRule(noPatternRule, transactions[0]!)).toBe(false);

    const emptyTx: RuleTransactionCandidate = {
      id: "tx-empty",
      amount: -10,
    };
    const result = applyRulesToTransaction([], emptyTx);
    expect(result.updated.merchant).toBe("");
  });
});
