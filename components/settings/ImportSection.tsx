"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";

interface AccountOption {
  id: string;
  name: string | null;
  mask: string | null;
}

interface ImportResult {
  imported: number;
  skipped_overlap: number;
  parse_errors: string[];
}

/** Upload a bank-statement CSV to backfill pre-Plaid history into an account. */
export default function ImportSection({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [positiveIsIncome, setPositiveIsIncome] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);

    const fileInput = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file || !accountId) {
      setError("Choose a CSV file and a target account.");
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("account_id", accountId);
      form.set("positive_is_income", String(positiveIsIncome));

      const res = await fetch("/api/import/csv", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Import failed");

      setResult({
        imported: json.imported ?? 0,
        skipped_overlap: json.skipped_overlap ?? 0,
        parse_errors: json.parse_errors ?? [],
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Import data" eyebrow="CSV backfill">
      <p className="mb-4 text-sm text-muted">
        Backfill history older than Plaid provides (max 24 months) from a bank-statement
        CSV. Needs date, description, and amount (or debit/credit) columns. Rows that
        overlap the account&apos;s Plaid-synced history are skipped automatically, and
        re-importing the same file never duplicates.
      </p>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted">Connect a bank first. Imports attach to an account.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3 text-sm">
          <label className="flex min-h-32 flex-col items-center justify-center rounded-card border border-dashed border-panel-border bg-panel-2 px-4 py-8 text-center text-sm text-muted">
            <span className="font-semibold text-foreground">Drag and drop your CSV file here</span>
            <span className="mt-1">or choose a file</span>
            <Input type="file" name="file" accept=".csv,text/csv" required className="mt-4 max-w-xs" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              Into account
              <Select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? "Account"}
                    {a.mask ? ` **${a.mask}` : ""}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={positiveIsIncome}
                onChange={(e) => setPositiveIsIncome(e.target.checked)}
              />
              Positive amounts are deposits (most bank CSVs)
            </label>
          </div>
          <Button
            type="submit"
            loading={busy}
          >
            {busy ? "Importing..." : "Import CSV"}
          </Button>
        </form>
      )}

      {result && (
        <div className="mt-4 space-y-1 rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
          <p className="font-medium">
            Imported {result.imported.toLocaleString()} transaction
            {result.imported === 1 ? "" : "s"}
            {result.skipped_overlap > 0 &&
              ` - ${result.skipped_overlap} skipped (overlap with Plaid history)`}
          </p>
          {result.parse_errors.length > 0 && (
            <details>
              <summary className="cursor-pointer">
                {result.parse_errors.length} line{result.parse_errors.length === 1 ? "" : "s"} could
                not be parsed
              </summary>
              <ul className="mt-1 list-disc pl-5 opacity-90">
                {result.parse_errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
