"use client";

import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import { formatMonth } from "@/lib/format";
import {
  buildStatementCoverage,
  parseStatementAccountRef,
  type StatementCoverageAccount,
  type StatementMetadata,
} from "@/lib/statement-vault";

function accountKey(account: StatementCoverageAccount["ref"]): string {
  return `${account.source}:${account.id}`;
}

function statusText(status: "missing" | "covered" | "duplicate", count: number): string {
  if (status === "missing") return "Missing";
  if (status === "duplicate") return `Duplicate (${count})`;
  return "Covered";
}

interface PublicStatement {
  id: string;
  account: string;
  month: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

function toMetadata(statement: PublicStatement): StatementMetadata {
  const account = parseStatementAccountRef(statement.account);
  if (!account) throw new Error("The server returned an invalid statement account");
  return {
    id: statement.id,
    accountId: account.source === "account" ? account.id : null,
    manualAccountId: account.source === "manual" ? account.id : null,
    statementMonth: statement.month,
    originalFilename: statement.filename,
    contentType: statement.contentType,
    sizeBytes: statement.sizeBytes,
    createdAt: statement.createdAt,
  };
}

export default function StatementVault({
  accounts,
  months,
  initialStatements,
}: Readonly<{
  accounts: StatementCoverageAccount[];
  months: string[];
  initialStatements: StatementMetadata[];
}>) {
  const [statements, setStatements] = useState(initialStatements);
  const [selectedAccount, setSelectedAccount] = useState(accounts[0] ? accountKey(accounts[0].ref) : "");
  const [selectedMonth, setSelectedMonth] = useState(months.at(-1) ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const coverage = useMemo(
    () => buildStatementCoverage(accounts, statements, months),
    [accounts, months, statements],
  );
  const cells = useMemo(
    () => new Map(coverage.map((cell) => [`${accountKey(cell.account)}|${cell.month}`, cell])),
    [coverage],
  );

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (!selectedAccount || !selectedMonth || !file) {
      setError("Choose an account, statement month, and PDF file.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set("account", selectedAccount);
      body.set("month", selectedMonth);
      body.set("file", file);
      const response = await fetch("/api/statements", { method: "POST", body });
      const payload = (await response.json()) as { statement?: PublicStatement; error?: string };
      if (!response.ok || !payload.statement) {
        throw new Error(payload.error ?? "Statement upload failed");
      }
      setStatements((current) => [toMetadata(payload.statement!), ...current]);
      setFile(null);
      const input = event.currentTarget.elements.namedItem("statement-file");
      if (input instanceof HTMLInputElement) input.value = "";
      setMessage(`Uploaded ${payload.statement.filename}.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Statement upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(statement: StatementMetadata) {
    setMessage(null);
    setError(null);
    setDeletingId(statement.id);
    try {
      const response = await fetch(`/api/statements/${statement.id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Statement deletion failed");
      setStatements((current) => current.filter((item) => item.id !== statement.id));
      setMessage(`Deleted ${statement.originalFilename}.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Statement deletion failed");
    } finally {
      setDeletingId(null);
    }
  }

  if (accounts.length === 0) {
    return (
      <Panel title="Statement coverage">
        <p className="text-sm text-muted">
          Add a connected or manual account before uploading a statement.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <Panel title="Upload a statement" eyebrow="Private PDF vault">
        <p className="mb-4 max-w-3xl text-sm text-muted">
          PDFs are stored privately and listed as metadata only. FundFlow does not parse or interpret statement contents.
        </p>
        <form className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_minmax(0,1fr)_auto] md:items-end" onSubmit={upload}>
          <label className="grid gap-1.5 text-sm font-semibold">
            Account
            <select className="min-h-11 rounded-field border border-panel-border bg-panel px-3" value={selectedAccount} onChange={(event) => setSelectedAccount(event.target.value)}>
              {accounts.map((account) => (
                <option key={accountKey(account.ref)} value={accountKey(account.ref)}>{account.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Month
            <select className="min-h-11 rounded-field border border-panel-border bg-panel px-3" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
              {months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            PDF file
            <input id="statement-file" name="statement-file" className="min-h-11 rounded-field border border-panel-border bg-panel px-3 py-2 text-sm" type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <Button type="submit" loading={busy} disabled={busy}>{busy ? "Uploading" : "Upload PDF"}</Button>
        </form>
        {message && <p className="mt-3 text-sm text-success" role="status">{message}</p>}
        {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      </Panel>

      <Panel title="Coverage grid" eyebrow="Last 12 months">
        <p className="mb-4 text-sm text-muted">
          Each cell is scoped to one account and month. Duplicate uploads stay visible for review.
        </p>
        <div className="overflow-x-auto rounded-field border border-panel-border">
          <table className="min-w-[58rem] w-full border-collapse text-left text-sm">
            <caption className="sr-only">Statement coverage by account and month</caption>
            <thead className="bg-panel-hover/50">
              <tr>
                <th className="sticky left-0 z-10 min-w-48 border-b border-panel-border bg-panel-hover/90 px-3 py-2 font-semibold" scope="col">Account</th>
                {months.map((month) => <th className="min-w-28 border-b border-panel-border px-3 py-2 font-semibold" key={month} scope="col">{formatMonth(month)}</th>)}
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={accountKey(account.ref)}>
                  <th className="sticky left-0 z-10 border-b border-panel-border bg-panel px-3 py-3 font-semibold" scope="row">{account.label}</th>
                  {months.map((month) => {
                    const cell = cells.get(`${accountKey(account.ref)}|${month}`)!;
                    const label = statusText(cell.status, cell.count);
                    return <td className="border-b border-panel-border px-3 py-3" key={month} aria-label={`${account.label}, ${formatMonth(month)}: ${label}`}>
                      <span className={cell.status === "covered" ? "text-success" : cell.status === "duplicate" ? "text-warning" : "text-muted"}>{label}</span>
                    </td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">Status is written as text, so coverage does not depend on color alone.</p>
      </Panel>

      <Panel title="Uploaded statements" eyebrow="Metadata only">
        {statements.length === 0 ? <p className="text-sm text-muted">No statements uploaded yet.</p> : (
          <ul className="divide-y divide-panel-border">
            {statements.map((statement) => (
              <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0" key={statement.id}>
                <div>
                  <p className="font-semibold">{statement.originalFilename}</p>
                  <p className="text-sm text-muted">{formatMonth(statement.statementMonth)} · {(statement.sizeBytes / 1024 / 1024).toFixed(1)} MiB</p>
                </div>
                <Button variant="danger" size="sm" loading={deletingId === statement.id} disabled={deletingId !== null} onClick={() => remove(statement)}>
                  {deletingId === statement.id ? "Deleting" : "Delete"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
