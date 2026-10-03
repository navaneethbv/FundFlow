import { TAX_BUCKETS, type summarizeTaxBuckets, type TaxBucket } from "@/lib/investment-provenance";
import { formatCurrency } from "@/lib/format";
export default function TaxBucketSummary({ summary }: Readonly<{ summary: ReturnType<typeof summarizeTaxBuckets> }>) {
  return <div className="space-y-3"><dl className="space-y-2">{Object.entries(summary.buckets).map(([key, value]) => <div key={key} className="flex flex-wrap justify-between gap-2"><dt>{TAX_BUCKETS[key as TaxBucket]}</dt><dd data-money>{formatCurrency(value)}</dd></div>)}</dl>
    <p className="text-xs text-muted">US account classifications, not tax advice or after-tax projections. Unknown stays unclassified. {summary.unavailable} account(s) omitted because balance or USD currency is unavailable.</p></div>;
}
