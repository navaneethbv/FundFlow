import {
  matchesAmountCondition,
  safeCompileRegex,
  type SmartRule,
  type RuleTransactionCandidate,
  type AmountCondition,
  type RuleMatchType,
} from "@/lib/rules-engine";
export type TextField =
  | "merchant"
  | "name"
  | "descriptor"
  | "account"
  | "category"
  | "tag"
  | "notes"
  | "type";
export type RuleCondition =
  | { op: "and" | "or"; children: RuleCondition[] }
  | {
      field: TextField;
      operator: "contains" | "equals" | "regex";
      value: string;
    }
  | {
      field: "amount";
      operator: AmountCondition["operator"];
      value?: number;
      maxValue?: number;
    }
  | { field: "legacy"; matchType: RuleMatchType; pattern: string };
export const RULE_MAX_DEPTH = 3;
export const RULE_MAX_LEAVES = 20;
export const RULE_BATCH_WORK_LIMIT = 1_000_000;
const fields = new Set([
  "merchant",
  "name",
  "descriptor",
  "account",
  "category",
  "tag",
  "notes",
  "type",
]);
function validateLeaf(node: Record<string, unknown>): boolean {
  if (node.field === "legacy")
    return (
      ["merchant", "keyword", "account", "regex"].includes(
        String(node.matchType),
      ) &&
      typeof node.pattern === "string" &&
      node.pattern.trim().length > 0 &&
      node.pattern.length <= 300 &&
      (node.matchType !== "regex" || !!safeCompileRegex(node.pattern))
    );
  if (node.field === "amount")
    return (
      ["gt", "gte", "lt", "lte", "between", "any"].includes(
        String(node.operator),
      ) &&
      (node.operator === "any" ||
        (typeof node.value === "number" &&
          Number.isFinite(node.value) &&
          Math.abs(node.value) <= 1e12)) &&
      (node.maxValue === undefined ||
        (typeof node.maxValue === "number" &&
          Number.isFinite(node.maxValue) &&
          Math.abs(node.maxValue) <= 1e12))
    );
  return (
    fields.has(String(node.field)) &&
    ["contains", "equals", "regex"].includes(String(node.operator)) &&
    typeof node.value === "string" &&
    node.value.trim().length > 0 &&
    node.value.length <= 300 &&
    (node.operator !== "regex" || !!safeCompileRegex(node.value))
  );
}
export function validateConditions(value: unknown): value is RuleCondition {
  let leaves = 0;
  function visit(node: unknown, depth: number): boolean {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false;
    const record = node as Record<string, unknown>;
    if ("op" in record)
      return (
        depth <= RULE_MAX_DEPTH &&
        ["and", "or"].includes(String(record.op)) &&
        Array.isArray(record.children) &&
        record.children.length > 0 &&
        record.children.length <= RULE_MAX_LEAVES &&
        record.children.every((child) => visit(child, depth + 1))
      );
    leaves++;
    return leaves <= RULE_MAX_LEAVES && validateLeaf(record);
  }
  return visit(value, 1);
}
/** Conversion preserves the legacy engine's truncation, fallback and absolute amount semantics. */
export function legacyToConditions(rule: SmartRule): RuleCondition {
  const children: RuleCondition[] = [
    { field: "legacy", matchType: rule.matchType, pattern: rule.pattern },
  ];
  if (rule.amountCondition)
    children.push({ field: "amount", ...rule.amountCondition });
  return { op: "and", children };
}
function legacyMatch(
  node: Extract<RuleCondition, { field: "legacy" }>,
  tx: RuleTransactionCandidate,
  compiled?: Pick<RegExp, "test"> | null,
): boolean {
  const merchant = (tx.merchant ?? "").trim().slice(0, 300);
  const name = (tx.name ?? "").trim().slice(0, 300);
  const account = (tx.accountName ?? "").trim().slice(0, 300);
  const pattern = node.pattern.trim().toLowerCase();
  if (!pattern) return false;
  if (node.matchType === "merchant")
    return (merchant || name).toLowerCase().includes(pattern);
  if (node.matchType === "keyword")
    return `${merchant} ${name}`.toLowerCase().includes(pattern);
  if (node.matchType === "account")
    return account.toLowerCase().includes(pattern);
  const regex =
    compiled === undefined ? safeCompileRegex(node.pattern) : compiled;
  return !!regex && (regex.test(merchant) || regex.test(name));
}
function leafValues(field: TextField, tx: RuleTransactionCandidate): string[] {
  const values: Record<TextField, string[]> = {
    merchant: [tx.merchant ?? ""],
    name: [tx.name ?? ""],
    descriptor: [tx.descriptor ?? ""],
    account: [tx.accountId ?? ""],
    category: [tx.category ?? ""],
    tag: tx.tags ?? [],
    notes: [tx.notes ?? ""],
    type: [tx.type ?? ""],
  };
  return values[field];
}
export function evaluateConditions(
  node: RuleCondition,
  tx: RuleTransactionCandidate,
  legacyCompiled?: Pick<RegExp, "test"> | null,
): boolean {
  if ("op" in node)
    return node.op === "and"
      ? node.children.every((child) =>
          evaluateConditions(child, tx, legacyCompiled),
        )
      : node.children.some((child) =>
          evaluateConditions(child, tx, legacyCompiled),
        );
  if (node.field === "legacy") return legacyMatch(node, tx, legacyCompiled);
  if (node.field === "amount") return matchesAmountCondition(tx.amount, node);
  const values = leafValues(node.field, tx).map((value) =>
    value.trim().slice(0, 300),
  );
  if (node.operator === "regex") {
    const regex = safeCompileRegex(node.value);
    return !!regex && values.some((value) => regex.test(value));
  }
  const pattern = node.value.trim().toLowerCase();
  return values.some((value) =>
    node.operator === "equals"
      ? value.toLowerCase() === pattern
      : value.toLowerCase().includes(pattern),
  );
}
export function conditionWork(node: RuleCondition): number {
  return "op" in node
    ? 1 + node.children.reduce((sum, child) => sum + conditionWork(child), 0)
    : 1;
}

/** Compile regex leaves once per bounded batch, never once per transaction. */
export function compileConditions(
  node: RuleCondition,
  legacyCompiled?: Pick<RegExp, "test"> | null,
): (tx: RuleTransactionCandidate) => boolean {
  if ("op" in node) {
    const children = node.children.map((child) =>
      compileConditions(child, legacyCompiled),
    );
    return node.op === "and"
      ? (tx) => children.every((match) => match(tx))
      : (tx) => children.some((match) => match(tx));
  }
  if (node.field === "legacy") {
    const regex =
      legacyCompiled === undefined && node.matchType === "regex"
        ? safeCompileRegex(node.pattern)
        : legacyCompiled;
    return (tx) => legacyMatch(node, tx, regex);
  }
  if (node.field !== "amount" && node.operator === "regex") {
    const regex = safeCompileRegex(node.value);
    return (tx) =>
      !!regex &&
      leafValues(node.field, tx).some((value) =>
        regex.test(value.trim().slice(0, 300)),
      );
  }
  return (tx) => evaluateConditions(node, tx);
}
