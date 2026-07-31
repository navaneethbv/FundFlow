/**
 * Phase 12: which optional ledger columns are visible, persisted as a plain
 * GET query param (`col`, repeated once per visible column) rather than
 * client state — the same pattern the rest of the ledger's filters already
 * use, so column visibility survives a reload or a shared link.
 *
 * A native multi-checkbox form submits zero `col` values both when nothing
 * is checked and when the form was never touched, so a hidden
 * `colsSubmitted` marker distinguishes "the user explicitly hid every
 * optional column" from "no preference was ever set" — the two cases need
 * different defaults (all-hidden vs. all-visible).
 */
export const LEDGER_COLUMNS = ["category", "account", "source"] as const;
export type LedgerColumn = (typeof LEDGER_COLUMNS)[number];

export const DEFAULT_LEDGER_COLUMNS: LedgerColumn[] = [...LEDGER_COLUMNS];

export function parseLedgerColumns(input: {
  col: string | string[] | undefined;
  colsSubmitted: string | string[] | undefined;
}): Set<LedgerColumn> {
  if (!input.colsSubmitted) return new Set(DEFAULT_LEDGER_COLUMNS);
  const known = new Set(LEDGER_COLUMNS);
  const values = Array.isArray(input.col) ? input.col : input.col ? [input.col] : [];
  return new Set(values.filter((c): c is LedgerColumn => known.has(c as LedgerColumn)));
}
