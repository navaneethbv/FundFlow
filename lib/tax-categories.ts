/**
 * Tax season preset: a curated set of tax line items that a preparer or tax
 * software actually asks for, resolved from the free-form tags users already
 * assign in the ledger editor. The tag is the categorization surface (no new
 * column, no new editor) — this module is only the allowlist that decides
 * which tag spellings map to which line item in the yearly tax export.
 *
 * Data only: an export grouped by these line items is not tax advice, and the
 * export says so where it is surfaced (Settings → Export data).
 */

export interface TaxCategory {
  /** Canonical line-item label written into the export's Category column. */
  lineItem: string;
  /** Accepted tag spellings, compared in normalized form. */
  aliases: string[];
}

export const TAX_CATEGORIES: readonly TaxCategory[] = [
  {
    lineItem: "W-2 income",
    aliases: ["w2 income", "w2", "paycheck", "salary", "wages"],
  },
  {
    lineItem: "Mortgage interest",
    aliases: ["mortgage interest", "mortgage"],
  },
  {
    lineItem: "Charitable donations",
    aliases: ["charitable donations", "charitable", "charity", "donation", "donations"],
  },
  {
    lineItem: "Capital gains",
    aliases: ["capital gains"],
  },
  {
    lineItem: "Capital losses",
    aliases: ["capital losses"],
  },
  {
    lineItem: "Medical expenses",
    aliases: ["medical expenses", "medical", "healthcare"],
  },
  {
    lineItem: "Childcare and dependent care",
    aliases: ["childcare", "dependent care", "daycare"],
  },
  {
    lineItem: "Retirement contributions",
    aliases: ["retirement contributions", "retirement", "401k", "ira", "traditional ira", "roth ira"],
  },
  {
    lineItem: "Student loan interest",
    aliases: ["student loan interest", "student loan", "student loans"],
  },
  {
    lineItem: "State and local taxes",
    aliases: ["state and local taxes", "state tax", "state taxes", "local tax", "property tax", "property taxes", "salt"],
  },
  {
    lineItem: "Deductible business expenses",
    aliases: ["deductible business expenses", "business expense", "business expenses", "deductible", "schedule c"],
  },
] as const;

/**
 * Line item for transactions tagged with the legacy bare "tax" tag that predate
 * the curated set — they are tax-relevant but not attributable to a line item.
 */
export const TAX_FALLBACK_LINE_ITEM = "Other tax-tagged";

/** Lowercase and strip punctuation/whitespace variance: "401(k)" → "401k". */
export function normalizeTaxTag(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const ALIAS_INDEX: ReadonlyMap<string, string> = new Map(
  TAX_CATEGORIES.flatMap((category) =>
    category.aliases.map((alias) => [normalizeTaxTag(alias), category.lineItem] as const),
  ),
);

/**
 * Resolve the tax line item for a transaction's tags, or null when none of the
 * tags are tax-relevant. The first tag (in the transaction's own tag order)
 * that matches a curated category wins; the legacy bare "tax" tag applies only
 * when no curated alias matched.
 */
export function resolveTaxLineItem(tags: readonly string[]): string | null {
  let sawLegacyTaxTag = false;
  for (const tag of tags) {
    const normalized = normalizeTaxTag(tag);
    const lineItem = ALIAS_INDEX.get(normalized);
    if (lineItem) return lineItem;
    if (normalized === "tax") sawLegacyTaxTag = true;
  }
  return sawLegacyTaxTag ? TAX_FALLBACK_LINE_ITEM : null;
}
