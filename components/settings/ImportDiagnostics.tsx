import type { ImportPreflight } from "@/lib/import-preflight";

const signLabels = {
  positive_deposits: "Positive amounts are deposits (your selected convention).",
  positive_spend: "Positive amounts are spending (your selected convention).",
  split: "Money direction comes from the debit and credit columns.",
};

export default function ImportDiagnostics({ report }: Readonly<{ report: ImportPreflight }>) {
  return (
    <section aria-label="File diagnostics" className="mt-4 space-y-2 rounded-field border border-panel-border bg-panel-2 p-3 text-sm">
      <h3 className="font-semibold">File check</h3>
      <output className="block">{report.validRows} of {report.totalRows} rows passed. {report.issueCount} issue{report.issueCount === 1 ? "" : "s"} found.</output>
      <p className="text-muted">Delimiter: {report.delimiter}. Header line: {report.headerRow ?? "not found"}.</p>
      <p className="text-muted">{signLabels[report.signConvention]}</p>
      <p className="text-muted">{report.outflowRows} spending rows and {report.inflowRows} deposit rows.</p>
      <p className="text-muted">Amounts use a decimal point. Line numbers refer to the uploaded file, including blank lines.</p>
      {!report.canPreview && <p className="text-warning">Fix the reported errors or adjust your settings, then preview again. No transactions have been staged.</p>}
      {report.issues.length > 0 && (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Import diagnostic details</caption>
            <thead><tr><th className="p-2">Line</th><th className="p-2">Level</th><th className="p-2">Details</th></tr></thead>
            <tbody>{report.issues.map((issue, index) => <tr key={`${issue.code}-${issue.row}-${index}`} className="border-t border-panel-border">
              <td className="p-2">{issue.row ?? "File"}</td><td className="p-2">{issue.severity}</td><td className="p-2">{issue.message}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {report.truncated && <p className="text-muted">Showing the first 100 issues. All detected issues are included in the total.</p>}
    </section>
  );
}
