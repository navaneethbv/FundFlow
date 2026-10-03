import { describe, expect, it } from "vitest";
import {
  evaluateConditions,
  compileConditions,
  legacyToConditions,
  validateConditions,
  type RuleCondition,
} from "@/lib/rule-conditions";
import {
  evaluateRule,
  simulateRulesBatch,
  type SmartRule,
} from "@/lib/rules-engine";
const tx = {
  id: "t",
  merchant: " Coffee ",
  name: "POS",
  accountId: "a",
  accountName: "Bank",
  amount: -42,
  descriptor: "RAW",
  notes: "Trip",
  tags: ["travel"],
  category: "FOOD",
  type: "expense",
};
describe("compound conditions", () => {
  it("preserves a legacy match AND amount, including false and enabled states", () => {
    for (const matchType of [
      "merchant",
      "keyword",
      "account",
      "regex",
    ] as const) {
      for (const pattern of ["coffee", "bank", "pos", "missing", "^coffee$"]) {
        for (const operator of [
          "any",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
        ] as const) {
          const rule: SmartRule = {
            id: "r",
            matchType,
            pattern,
            amountCondition: { operator, value: 42, maxValue: 100 },
          };
          expect(evaluateConditions(legacyToConditions(rule), tx)).toBe(
            evaluateRule(rule, tx),
          );
          expect(
            evaluateRule(
              { ...rule, conditions: legacyToConditions(rule), enabled: false },
              tx,
            ),
          ).toBe(false);
        }
      }
    }
  });
  it("supports all fields, stable account ids, OR and guarded regex", () => {
    for (const [field, value] of [
      ["merchant", "coffee"],
      ["name", "pos"],
      ["descriptor", "raw"],
      ["account", "a"],
      ["notes", "trip"],
      ["tag", "travel"],
      ["category", "food"],
      ["type", "expense"],
    ] as const) {
      expect(evaluateConditions({ field, operator: "equals", value }, tx)).toBe(
        true,
      );
    }
    expect(
      evaluateConditions(
        {
          op: "or",
          children: [
            { field: "name", operator: "contains", value: "never" },
            { field: "descriptor", operator: "regex", value: "^raw$" },
          ],
        },
        tx,
      ),
    ).toBe(true);
    expect(
      validateConditions({ field: "name", operator: "regex", value: "(a+)+$" }),
    ).toBe(false);
  });
  it("bounds depth, leaf count and batch work, rejecting malformed data", () => {
    const leaf: RuleCondition = {
      field: "name",
      operator: "contains",
      value: "pos",
    };
    const group: RuleCondition = { op: "and", children: [leaf] };
    expect(
      validateConditions({
        op: "and",
        children: [{ op: "or", children: [group] }],
      }),
    ).toBe(true);
    expect(
      validateConditions({
        op: "and",
        children: [{ op: "or", children: [{ op: "and", children: [group] }] }],
      }),
    ).toBe(false);
    expect(
      validateConditions({ op: "and", children: Array(21).fill(leaf) }),
    ).toBe(false);
    for (const invalid of [
      null,
      [],
      {},
      { op: "and", children: [] },
      { field: "amount", operator: "gt", value: Infinity },
    ])
      expect(validateConditions(invalid)).toBe(false);
    const rule: SmartRule = {
      id: "r",
      matchType: "keyword",
      pattern: "x",
      conditions: { op: "and", children: Array(20).fill(leaf) },
    };
    expect(() =>
      simulateRulesBatch(Array(100).fill(rule), Array(1000).fill(tx)),
    ).toThrow("evaluation limit");
  });
  it("retains the first matching rule's action", () => {
    const rule: SmartRule = {
      id: "first",
      matchType: "merchant",
      pattern: "coffee",
      category: "DRINK",
      conditions: { field: "amount", operator: "gte", value: 40 },
    };
    expect(
      simulateRulesBatch(
        [rule, { ...rule, id: "second", category: "FOOD" }],
        [tx],
      ).results[0]?.updated.category,
    ).toBe("DRINK");
  });
});

it("compiled groups preserve OR, bounded regex and legacy fallbacks", () => {
  const conditions: RuleCondition[] = [
    { op: "or", children: [{ field: "merchant", operator: "equals", value: "missing" }, { field: "tag", operator: "regex", value: "^travel$" }] },
    { field: "legacy", matchType: "regex", pattern: "^coffee$" },
    { field: "legacy", matchType: "merchant", pattern: "pos" },
    { field: "legacy", matchType: "keyword", pattern: "" },
    { field: "descriptor", operator: "regex", value: "[" },
    { field: "amount", operator: "any" },
  ];
  for (const condition of conditions) {
    for (const candidate of [tx, { id: "empty", amount: 0 }, { ...tx, merchant: null }]) {
      expect(compileConditions(condition)(candidate)).toBe(evaluateConditions(condition, candidate));
    }
  }
  expect(validateConditions({ field: "amount", operator: "between", value: 1, maxValue: Infinity })).toBe(false);
  expect(validateConditions({ field: "legacy", matchType: "regex", pattern: "[" })).toBe(false);
});
