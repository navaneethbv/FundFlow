"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    <section className="rounded-lg border border-black/10 dark:border-white/15 p-4 space-y-3">
      <h2 className="font-semibold">Import history (CSV)</h2>
      <p className="text-sm opacity-80">
        Backfill history older than Plaid provides (max 24 months) from a bank-statement
        CSV. Needs date, description, and amount (or debit/credit) columns. Rows that
        overlap the account&apos;s Plaid-synced history are skipped automatically, and
        re-importing the same file never duplicates.
      </p>

      {accounts.length === 0 ? (
        <p className="text-sm opacity-60">Connect a bank first — imports attach to an account.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3 text-sm">
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="block w-full text-sm file:mr-3 file:rounded file:border file:border-black/15 dark:file:border-white/25 file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              Into account
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1.5"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? "Account"}
                    {a.mask ? ` ••${a.mask}` : ""}
                  </option>
                ))}
              </select>
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
          <button
            type="submit"
            disabled={busy}
            className="rounded border border-black/15 dark:border-white/25 px-3 py-1.5 disabled:opacity-50"
          >
            {busy ? "Importing…" : "Import CSV"}
          </button>
        </form>
      )}

      {result && (
        <div className="text-sm space-y-1 rounded-lg bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20 p-3">
          <p className="font-medium">
            Imported {result.imported.toLocaleString()} transaction
            {result.imported === 1 ? "" : "s"}
            {result.skipped_overlap > 0 &&
              ` · ${result.skipped_overlap} skipped (overlap with Plaid history)`}
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
    </section>
  );
}
