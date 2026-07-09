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

interface MappingState {
  headers: string[];
  sample: string[][];
}

/**
 * Two-step CSV import: preview parsed rows with duplicate flags, then commit
 * only the rows the user keeps. Flagged (possible/file duplicate) rows are
 * unchecked by default so the safe path never re-imports duplicates. When
 * columns can't be auto-detected, a manual column-mapping step is offered.
 */
export default function ImportReviewSection({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [positiveIsIncome, setPositiveIsIncome] = useState(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<MappingState | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<number | null>(null);

  // Manual column-mapping choices (index-as-string; "" = unset/none).
  const [mapDate, setMapDate] = useState("");
  const [mapDescription, setMapDescription] = useState("");
  const [amountMode, setAmountMode] = useState<"single" | "split">("single");
  const [mapAmount, setMapAmount] = useState("");
  const [mapDebit, setMapDebit] = useState("");
  const [mapCredit, setMapCredit] = useState("");
  const [mapCategory, setMapCategory] = useState("");

  async function runPreview(file: File, columnMap?: Record<string, number | null>) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("positive_is_income", String(positiveIsIncome));
      if (columnMap) form.set("column_map", JSON.stringify(columnMap));
      const res = await fetch("/api/import/preview", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Preview failed");
      if (json.needs_mapping) {
        setMapping({ headers: json.headers ?? [], sample: json.sample ?? [] });
        setRows([]);
        setBatchId(null);
        return;
      }
      setMapping(null);
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

  async function onPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCommitted(null);
    setMapping(null);
    const fileInput = event.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file || !accountId) {
      setError("Choose a CSV file and a target account.");
      return;
    }
    setPendingFile(file);
    await runPreview(file);
  }

  function onApplyMapping(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingFile) return;
    if (mapDate === "" || mapDescription === "") {
      setError("Map at least the date and description columns.");
      return;
    }
    if (amountMode === "single" ? mapAmount === "" : mapDebit === "" && mapCredit === "") {
      setError("Map an amount column (or a debit/credit column).");
      return;
    }
    const toIdx = (v: string) => (v === "" ? null : Number(v));
    runPreview(pendingFile, {
      date: Number(mapDate),
      description: Number(mapDescription),
      amount: amountMode === "single" ? toIdx(mapAmount) : null,
      debit: amountMode === "split" ? toIdx(mapDebit) : null,
      credit: amountMode === "split" ? toIdx(mapCredit) : null,
      category: toIdx(mapCategory),
    });
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
  const columnOptions = (placeholder: string, includeNone = false) => (
    <>
      <option value="">{includeNone ? "None" : placeholder}</option>
      {(mapping?.headers ?? []).map((h, i) => (
        <option key={i} value={i}>
          {h || `Column ${i + 1}`}
        </option>
      ))}
    </>
  );

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

      {mapping && (
        <form onSubmit={onApplyMapping} className="mt-4 space-y-3 rounded-field border border-panel-border bg-panel-2 p-3 text-sm">
          <p className="text-muted">
            We couldn&apos;t auto-detect the columns. Map them manually, then preview again.
          </p>
          {mapping.sample.length > 0 && (
            <div className="overflow-x-auto rounded-field border border-panel-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-panel text-muted">
                  <tr>
                    {mapping.headers.map((h, i) => (
                      <th key={i} className="whitespace-nowrap p-2 font-semibold">
                        {h || `Column ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mapping.sample.map((r, ri) => (
                    <tr key={ri} className="border-t border-panel-border">
                      {mapping.headers.map((_, ci) => (
                        <td key={ci} className="whitespace-nowrap p-2 text-muted">
                          {r[ci] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              Date column
              <Select value={mapDate} onChange={(e) => setMapDate(e.target.value)}>
                {columnOptions("Select column")}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              Description column
              <Select value={mapDescription} onChange={(e) => setMapDescription(e.target.value)}>
                {columnOptions("Select column")}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              Amount format
              <Select value={amountMode} onChange={(e) => setAmountMode(e.target.value as "single" | "split")}>
                <option value="single">One signed amount column</option>
                <option value="split">Separate debit / credit columns</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              Category column <span className="text-muted">(optional)</span>
              <Select value={mapCategory} onChange={(e) => setMapCategory(e.target.value)}>
                {columnOptions("None", true)}
              </Select>
            </label>
            {amountMode === "single" ? (
              <label className="flex flex-col gap-1">
                Amount column
                <Select value={mapAmount} onChange={(e) => setMapAmount(e.target.value)}>
                  {columnOptions("Select column")}
                </Select>
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  Debit (money out) column
                  <Select value={mapDebit} onChange={(e) => setMapDebit(e.target.value)}>
                    {columnOptions("None", true)}
                  </Select>
                </label>
                <label className="flex flex-col gap-1">
                  Credit (money in) column
                  <Select value={mapCredit} onChange={(e) => setMapCredit(e.target.value)}>
                    {columnOptions("None", true)}
                  </Select>
                </label>
              </>
            )}
          </div>
          <Button type="submit" loading={busy}>
            Preview with this mapping
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
