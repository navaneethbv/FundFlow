export interface PlaidCategoryMapping {
  pfcDetailed: string;
  displayCategory: string;
}

export function normalizePlaidCode(value: string): string {
  return value.trim().toUpperCase().slice(0, 120);
}

export function normalizeDisplayCategory(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 100);
}

export function buildPlaidCategoryMap(rows: readonly PlaidCategoryMapping[]): ReadonlyMap<string, string> {
  return new Map(rows
    .map((row) => [normalizePlaidCode(row.pfcDetailed), normalizeDisplayCategory(row.displayCategory)] as const)
    .filter(([code, category]) => Boolean(code) && Boolean(category)));
}

export function applyPlaidCategoryMapping<T extends { pfc_detailed: string | null; pfc_primary: string | null }>(
  row: T,
  mappings: ReadonlyMap<string, string>,
): T {
  const mapped = row.pfc_detailed ? mappings.get(normalizePlaidCode(row.pfc_detailed)) : undefined;
  return mapped ? { ...row, pfc_primary: mapped } : row;
}
