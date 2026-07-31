import { cn } from "@/lib/cn";
import { formatCurrency } from "@/lib/format";

/**
 * A rendered currency amount.
 *
 * Exists so the privacy blur is a property of "this is money" rather than
 * something each call site has to remember to opt into. `formatCurrency`
 * returns a bare string and is used in CSV rows, PDF output, and aria-labels
 * as well as in markup, so it cannot carry the marker itself — this wrapper
 * is the markup-side counterpart.
 *
 * Use `<Money>` for a standalone figure. For a dense surface (a ledger column,
 * a list of balances) prefer marking the container with `data-money` once.
 */
export default function Money({
  amount,
  currency,
  className,
  title,
}: Readonly<{
  amount: number | null | undefined;
  currency?: string;
  className?: string;
  title?: string;
}>) {
  return (
    <span className={cn("money", className)} title={title}>
      {formatCurrency(amount, currency)}
    </span>
  );
}
