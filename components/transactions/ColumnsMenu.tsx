import Link from "next/link";
import { LEDGER_COLUMNS, type LedgerColumn } from "@/lib/ledger-columns";

const LABELS: Record<LedgerColumn, string> = {
  category: "Category",
  account: "Account",
  source: "Source",
};

/**
 * A plain GET form like the ledger's other filters — column visibility is a
 * URL param, not client state, so it survives a reload or a shared link.
 * Every other filter's current value rides along as a hidden field so
 * submitting this form doesn't reset them.
 */
export default function ColumnsMenu({
  visible,
  isDefault,
  otherParams,
}: Readonly<{ visible: Set<LedgerColumn>; isDefault: boolean; otherParams: Record<string, string> }>) {
  const defaultsHref = (() => {
    const params = new URLSearchParams(otherParams);
    return `/transactions?${params.toString()}`;
  })();

  return (
    <form method="get" action="/transactions" className="flex flex-wrap items-center gap-3 text-xs">
      {Object.entries(otherParams).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <input type="hidden" name="colsSubmitted" value="1" />
      <span className="font-semibold text-muted">Columns:</span>
      {LEDGER_COLUMNS.map((col) => (
        <label key={col} className="flex items-center gap-1.5">
          <input
            type="checkbox"
            name="col"
            value={col}
            defaultChecked={visible.has(col)}
            className="h-3.5 w-3.5 rounded border-panel-border"
          />
          {LABELS[col]}
        </label>
      ))}
      <button type="submit" className="font-semibold text-accent hover:underline">
        Apply
      </button>
      {!isDefault && (
        <Link href={defaultsHref} className="text-muted hover:underline">
          Restore defaults
        </Link>
      )}
    </form>
  );
}
