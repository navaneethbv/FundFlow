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

interface ReviewRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  status: string;
  flags: string[];
}

/**
 * Two-step CSV import: preview parsed rows with duplicate flags, then commit
 * only the rows the user keeps. Flagged (possible/file duplicate) rows are
 * unchecked by default so the safe path never re-imports duplicates.
 */
export default function ImportReviewSection({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [positiveIsIncome, setPositiveIsIncome] = useState(true);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<number | null>(null);

  async function onPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCommitted(null);
    const fileInput = event.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file || !accountId) {
      setError("Choose a CSV file and a target account.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("positive_is_income", String(positiveIsIncome));
      const res = await fetch("/api/import/preview", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Preview failed");
      const previewRows = (json.rows ?? []) as ReviewRow[];
      setBatchId(json.batch_id ?? null);
      setRows(previewRows);
      // Clean rows (no duplicate flags) start selected.
      setSelected(new Set(previewRows.filter((row) => row.flags.length === 0).map((row) => row.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onCommit() {
    if (!batchId) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          batch_id: batchId,
          account_id: accountId,
          approved_row_ids: [...selected],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setCommitted(json.imported ?? 0);
      setRows([]);
      setBatchId(null);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const selectableCount = rows.filter((row) => selected.has(row.id)).length;

  return (
    <Panel title="Import with review" eyebrow="CSV backfill">
      <p className="mb-4 text-sm text-muted">
        Preview a bank-statement CSV before importing. Rows that look like duplicates of
        existing transactions are flagged and left unchecked; you decide what lands.
      </p>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted">Connect a bank first. Imports attach to an account.</p>
      ) : (
        <form onSubmit={onPreview} className="space-y-3 text-sm">
          <Input type="file" name="file" accept=".csv,text/csv" required className="max-w-xs" />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              Into account
              <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name ?? "Account"}
                    {account.mask ? ` **${account.mask}` : ""}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={positiveIsIncome}
                onChange={(event) => setPositiveIsIncome(event.target.checked)}
              />
              Positive amounts are deposits
            </label>
          </div>
          <Button type="submit" loading={busy} variant="secondary">
            Preview file
          </Button>
        </form>
      )}

      {rows.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="max-h-72 overflow-auto rounded-field border border-panel-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-panel-2 text-muted">
                <tr>
                  <th className="p-2"> </th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Description</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2">Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-panel-border">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                      />
                    </td>
                    <td className="p-2 tabular-nums">{row.date}</td>
                    <td className="p-2">{row.description}</td>
                    <td className="p-2 text-right tabular-nums">{row.amount.toFixed(2)}</td>
                    <td className="p-2 text-muted">{row.flags.join(", ") || "new"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" onClick={onCommit} loading={busy} disabled={selectableCount === 0}>
            Import {selectableCount} selected
          </Button>
        </div>
      )}

      {committed !== null && (
        <p className="mt-3 text-sm text-success">
          Imported {committed} transaction{committed === 1 ? "" : "s"}.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
