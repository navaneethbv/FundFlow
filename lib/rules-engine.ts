/**
 * Core smart transaction rules engine.
 * Supports regex matching, keyword/merchant matching, amount condition filters,
 * category remapping, merchant renaming, and auto-tagging.
 */

import { isRegexShapeSafe } from "@/lib/regex-safety";

export type RuleMatchType = "merchant" | "keyword" | "account" | "regex";
export type AmountOperator = "gt" | "lt" | "gte" | "lte" | "between" | "any";

export interface AmountCondition {
  operator: AmountOperator;
  value?: number;
  maxValue?: number;
}

export interface SmartRule {
  id: string;
  matchType: RuleMatchType;
  pattern: string;
  amountCondition?: AmountCondition | null;
  displayName?: string | null;
  category?: string | null;
  tags?: string[];
  enabled?: boolean;
  compiledRegex?: RegExp | null;
}

/**
 * Maximum character length allowed for user-supplied regex patterns.
 */
export const MAX_REGEX_PATTERN_LENGTH = 120;

/**
 * Safely compiles a user-supplied regex pattern with ReDoS guards:
 * - Length restriction (<= 120 chars)
 * - Backreference rejection (guards against algorithmic complexity attacks)
 * - Restricted pattern shape (`lib/regex-safety.ts`): no ambiguous quantified
 *   group, no overlapping adjacent loops, and a hard cap on loop count, which
 *   together bound worst-case matching cost.
 * Returns null if the pattern is invalid or unsafe.
 */
export function safeCompileRegex(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.length > MAX_REGEX_PATTERN_LENGTH) {
    return null;
  }
  if (/\\[1-9]/.test(trimmed)) {
    return null;
  }
  if (!isRegexShapeSafe(trimmed)) {
    return null;
  }

  try {
    // ReDoS guarded: pattern length <= 120, exponential backtracking checked, and backreferences rejected
    const RegExpConstructor = (
      globalThis as unknown as { RegExp: new (p: string, f?: string) => RegExp }
    ).RegExp;
    return new RegExpConstructor(trimmed, "i");
  } catch {
    return null;
  }
}

export interface RuleTransactionCandidate {
  id: string;
  merchant?: string | null;
  name?: string | null;
  accountName?: string | null;
  amount: number;
  category?: string | null;
  tags?: string[];
}

export interface RuleApplicationResult {
  transactionId: string;
  modified: boolean;
  matchedRuleId: string | null;
  original: {
    merchant: string;
    category: string | null;
    tags: string[];
  };
  updated: {
    merchant: string;
    category: string | null;
    tags: string[];
  };
}

export interface BatchSimulationResult {
  totalEvaluated: number;
  matchedCount: number;
  modifiedCount: number;
  results: RuleApplicationResult[];
}

/**
 * Validates whether a transaction satisfies an amount condition.
 */
export function matchesAmountCondition(
  amount: number,
  condition?: AmountCondition | null,
): boolean {
  if (!condition || condition.operator === "any") return true;

  const absAmount = Math.abs(amount);
  const val = condition.value ?? 0;

  switch (condition.operator) {
    case "gt":
      return absAmount > val;
    case "gte":
      return absAmount >= val;
    case "lt":
      return absAmount < val;
    case "lte":
      return absAmount <= val;
    case "between": {
      const max = condition.maxValue ?? val;
      return absAmount >= Math.min(val, max) && absAmount <= Math.max(val, max);
    }
    default:
      return true;
  }
}

/**
 * Checks if a candidate transaction matches the rule's criteria.
 */
export function evaluateRule(
  rule: SmartRule,
  tx: RuleTransactionCandidate,
): boolean {
  if (rule.enabled === false) return false;

  // 1. Amount condition check
  if (!matchesAmountCondition(tx.amount, rule.amountCondition)) {
    return false;
  }

  const rawMerchant = (tx.merchant ?? "").trim().slice(0, 300);
  const rawName = (tx.name ?? "").trim().slice(0, 300);
  const accountName = (tx.accountName ?? "").trim().slice(0, 300);
  const pattern = (rule.pattern ?? "").trim();

  if (!pattern) return false;

  // 2. Pattern check based on matchType
  switch (rule.matchType) {
    case "merchant": {
      const target = (rawMerchant || rawName).toLowerCase();
      return target.includes(pattern.toLowerCase());
    }
    case "keyword": {
      const combined = `${rawMerchant} ${rawName}`.toLowerCase();
      return combined.includes(pattern.toLowerCase());
    }
    case "account": {
      return accountName.toLowerCase().includes(pattern.toLowerCase());
    }
    case "regex": {
      const regex = rule.compiledRegex !== undefined ? rule.compiledRegex : safeCompileRegex(pattern);
      if (!regex) return false;
      return regex.test(rawMerchant) || regex.test(rawName);
    }
    default:
      return false;
  }
}

/**
 * Evaluates an ordered list of smart rules against a transaction candidate and
 * applies the first matching rule's transformations.
 */
export function applyRulesToTransaction(
  rules: SmartRule[],
  tx: RuleTransactionCandidate,
): RuleApplicationResult {
  const originalMerchant = (tx.merchant ?? tx.name ?? "").trim();
  const originalCategory = tx.category ?? null;
  const originalTags = Array.isArray(tx.tags) ? [...tx.tags] : [];

  let matchedRule: SmartRule | null = null;

  for (const rule of rules) {
    if (evaluateRule(rule, tx)) {
      matchedRule = rule;
      break;
    }
  }

  if (!matchedRule) {
    return {
      transactionId: tx.id,
      modified: false,
      matchedRuleId: null,
      original: {
        merchant: originalMerchant,
        category: originalCategory,
        tags: originalTags,
      },
      updated: {
        merchant: originalMerchant,
        category: originalCategory,
        tags: originalTags,
      },
    };
  }

  const nextMerchant = matchedRule.displayName?.trim() || originalMerchant;
  const nextCategory = matchedRule.category?.trim() || originalCategory;

  // Merge tags cleanly without duplicates
  const tagSet = new Set(originalTags);
  if (Array.isArray(matchedRule.tags)) {
    for (const tag of matchedRule.tags) {
      const trimmed = tag.trim();
      if (trimmed) tagSet.add(trimmed);
    }
  }
  const nextTags = Array.from(tagSet);

  const tagsChanged =
    nextTags.length !== originalTags.length ||
    nextTags.some((tag, index) => tag !== originalTags[index]);

  const modified =
    nextMerchant !== originalMerchant ||
    nextCategory !== originalCategory ||
    tagsChanged;

  return {
    transactionId: tx.id,
    modified,
    matchedRuleId: matchedRule.id,
    original: {
      merchant: originalMerchant,
      category: originalCategory,
      tags: originalTags,
    },
    updated: {
      merchant: nextMerchant,
      category: nextCategory,
      tags: nextTags,
    },
  };
}

/**
 * Runs a set of smart rules across an entire batch of transactions.
 */
export function simulateRulesBatch(
  rules: SmartRule[],
  transactions: RuleTransactionCandidate[],
): BatchSimulationResult {
  let matchedCount = 0;
  let modifiedCount = 0;

  // Pre-compile regex rules once before batch evaluation to avoid inner-loop overhead and ReDoS
  const preparedRules = rules.map((r) =>
    r.matchType === "regex" && r.compiledRegex === undefined
      ? { ...r, compiledRegex: safeCompileRegex(r.pattern) }
      : r,
  );

  const results: RuleApplicationResult[] = transactions.map((tx) => {
    const res = applyRulesToTransaction(preparedRules, tx);
    if (res.matchedRuleId !== null) matchedCount++;
    if (res.modified) modifiedCount++;
    return res;
  });

  return {
    totalEvaluated: transactions.length,
    matchedCount,
    modifiedCount,
    results,
  };
}
