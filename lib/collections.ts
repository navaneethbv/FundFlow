import { TRANSFER_GROUPS } from "@/lib/finance-domain";

/**
 * Reference adoption 6.8: a collection groups transactions across categories
 * (a trip, a renovation) through a `collection:<name>` tag, the same tag bulk
 * edit writes. Spend follows Plaid's sign (positive is money out), nets
 * refunds, and excludes transfer categories like every other spend total.
 */
export const COLLECTION_TAG_PREFIX = "collection:";

export interface CollectionAnnotation { transaction_id: string; tags: string[] | null }
export interface CollectionTransaction { id: string; date: string; amount: number | string; pfc_primary: string | null }
export interface CollectionBudget { name: string; budget: number | string }

export interface CollectionSummary {
  name: string;
  spent: number;
  count: number;
  firstDate: string;
  lastDate: string;
  budget: number | null;
  remaining: number | null;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function collectionNameFromTag(tag: string): string | null {
  if (!tag.startsWith(COLLECTION_TAG_PREFIX)) return null;
  const name = tag.slice(COLLECTION_TAG_PREFIX.length).trim();
  return name || null;
}

function isTransfer(category: string | null): boolean {
  return Boolean(category && TRANSFER_GROUPS.has(category.toUpperCase()));
}

function addTransaction(group: CollectionSummary, txn: CollectionTransaction): void {
  if (!isTransfer(txn.pfc_primary)) group.spent = round2(group.spent + Number(txn.amount));
  group.count += 1;
  if (txn.date < group.firstDate) group.firstDate = txn.date;
  if (txn.date > group.lastDate) group.lastDate = txn.date;
}

export function buildCollections(
  annotations: readonly CollectionAnnotation[],
  transactions: readonly CollectionTransaction[],
  budgets: readonly CollectionBudget[],
): CollectionSummary[] {
  const byId = new Map(transactions.map((txn) => [txn.id, txn]));
  const budgetByName = new Map(budgets.map((row) => [row.name.trim().toLowerCase(), Number(row.budget)]));
  const groups = new Map<string, CollectionSummary>();
  for (const annotation of annotations) {
    const txn = byId.get(annotation.transaction_id);
    if (!txn) continue;
    for (const name of new Set((annotation.tags ?? []).map(collectionNameFromTag))) {
      if (!name) continue;
      const group = groups.get(name) ?? { name, spent: 0, count: 0, firstDate: txn.date, lastDate: txn.date, budget: null, remaining: null };
      addTransaction(group, txn);
      groups.set(name, group);
    }
  }
  return [...groups.values()]
    .map((group) => {
      const budget = budgetByName.get(group.name.toLowerCase());
      return budget === undefined || !Number.isFinite(budget)
        ? group
        : { ...group, budget, remaining: round2(budget - group.spent) };
    })
    .sort((left, right) => right.lastDate.localeCompare(left.lastDate) || left.name.localeCompare(right.name));
}
