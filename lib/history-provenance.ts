export type HistoryProvenance = "observed" | "estimated" | "manual";
/** Legacy rows have an explicit source, even though no provenance was stored. */
export function historyProvenance(
  value: HistoryProvenance | null | undefined,
  manualAccountId: string | null,
): HistoryProvenance {
  return value ?? (manualAccountId ? "manual" : "observed");
}
export const HISTORY_PROVENANCE_LABELS: Record<HistoryProvenance, string> = {
  observed: "Observed",
  estimated: "Estimate",
  manual: "Manual entry",
};
