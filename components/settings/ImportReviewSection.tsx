"use client";

import ImportDiagnostics from "@/components/settings/ImportDiagnostics";
import type { ImportPreflight } from "@/lib/import-preflight";
import { accountDisplayLabel } from "@/lib/account-label";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImportSteps, useImportFileDrop } from "@/components/settings/ImportWizard";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import { isOfxFileName } from "@/lib/import-ofx";

interface AccountOption {
  id: string;
  name: string | null;
  mask: string | null;
  kind: "account" | "manual";
}

interface ReviewRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  status: string;
  flags: string[];
  source_account?: string | null;
}

interface MappingState {
  headers: string[];
  sample: string[][];
}

interface ProfilePreview {
  needs_profile_choice?: boolean;
  profiles?: Array<{ id: string; name: string }>;
  can_save_profile?: boolean;
  applied_profile?: { id: string; name: string } | null;
  profile_settings?: { dateOrder: "mdy" | "dmy" | "ymd"; positiveIsIncome: boolean; skipRows: number } | null;
}

function profileCommitNotice(result: { profile_warning?: string; profile_saved?: boolean }): string | null {
  return result.profile_warning ?? (result.profile_saved ? "Saved this layout for future files with the same columns." : null);
}

function uniqueKeys(values: readonly unknown[], prefix: string): string[] {
  const counts = new Map<string, number>();
  return values.map((value) => {
    const base = String(value);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return `${prefix}-${base}-${count}`;
  });
}

/**
 * Two-step CSV import: preview parsed rows with duplicate flags, then commit
 * only the rows the user keeps. Flagged (possible/file duplicate) rows are
 * unchecked by default so the safe path never re-imports duplicates. When
 * columns can't be auto-detected, a manual column-mapping step is offered.
 */
export default function ImportReviewSection({ accounts, profilesEnabled = false, diagnosticsEnabled = false, wizardEnabled = false }: Readonly<{ accounts: AccountOption[]; profilesEnabled?: boolean; diagnosticsEnabled?: boolean; wizardEnabled?: boolean }>) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [positiveIsIncome, setPositiveIsIncome] = useState(true);
  const [dateOrder, setDateOrder] = useState<"auto" | "mdy" | "dmy" | "ymd">("auto");
  const [diagnostics, setDiagnostics] = useState<ImportPreflight | null>(null);
  const [skipRows, setSkipRows] = useState(0);
  const [profileId, setProfileId] = useState("");
  const [profileChoices, setProfileChoices] = useState<Array<{ id: string; name: string }>>([]);
  const [canSaveProfile, setCanSaveProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const saveProfileName = profilesEnabled && canSaveProfile ? profileName.trim() : "";
  const [appliedProfile, setAppliedProfile] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [dateFormatRequired, setDateFormatRequired] = useState(false);
  const [sourceAccounts, setSourceAccounts] = useState<string[]>([]);
  const [sourceAccountTargets, setSourceAccountTargets] = useState<Record<string, string>>({});
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<MappingState | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ruleWarning, setRuleWarning] = useState<string | null>(null);
  const [committed, setCommitted] = useState<number | null>(null);
  /** Review-row ids the server refused to overwrite; empty when there are none. */
  const [annotationConflicts, setAnnotationConflicts] = useState<string[]>([]);

  // Manual column-mapping choices (index-as-string; "" = unset/none).
  const [mapDate, setMapDate] = useState("");
  const [mapDescription, setMapDescription] = useState("");
  const [amountMode, setAmountMode] = useState<"single" | "split">("single");
  const [mapAmount, setMapAmount] = useState("");
  const [mapDebit, setMapDebit] = useState("");
  const [mapCredit, setMapCredit] = useState("");
  const [mapCategory, setMapCategory] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mappingFocusRef = useRef<HTMLHeadingElement>(null);
  const reviewFocusRef = useRef<HTMLHeadingElement>(null);
  const completeFocusRef = useRef<HTMLOutputElement>(null);

  const chooseWizardFile = useCallback((file: File | null) => {
    setRows([]); setBatchId(null); setSelected(new Set());
    setCommitted(null); setMapping(null); setDiagnostics(null);
    setProfileChoices([]); setProfileId(""); setAppliedProfile(null);
    setCanSaveProfile(false); setProfileName(""); setProfileNotice(null);
    setDateFormatRequired(false); setAnnotationConflicts([]);
    setDateOrder("auto"); setPositiveIsIncome(true); setSkipRows(0);
    setMapDate(""); setMapDescription(""); setMapAmount("");
    setMapDebit(""); setMapCredit(""); setMapCategory(""); setAmountMode("single");
    setSourceAccounts([]); setSourceAccountTargets({});
    if (!file) {
      setPendingFile(null); setError(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setPendingFile(null);
      setError("Choose a statement file that is 2 MB or smaller.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setError(null); setPendingFile(file);
    const transfer = new DataTransfer();
    transfer.items.add(file);
    if (fileInputRef.current) {
      fileInputRef.current.files = transfer.files;
      fileInputRef.current.focus();
    }
  }, []);
  const dropAvailable = wizardEnabled && accounts.length > 0;
  const draggingFile = useImportFileDrop(dropAvailable, busy, chooseWizardFile, setError);

  useEffect(() => {
    if (wizardEnabled && mapping) mappingFocusRef.current?.focus();
  }, [wizardEnabled, mapping]);
  useEffect(() => {
    if (wizardEnabled && rows.length > 0) reviewFocusRef.current?.focus();
  }, [wizardEnabled, rows.length]);
  useEffect(() => {
    if (wizardEnabled && committed !== null) completeFocusRef.current?.focus();
  }, [wizardEnabled, committed]);

  function changeFileSettings(change: () => void) {
    change();
    if (!wizardEnabled) return;
    setRows([]); setBatchId(null); setSelected(new Set());
    setDiagnostics(null); setCommitted(null); setAppliedProfile(null);
    setCanSaveProfile(false); setProfileNotice(null); setAnnotationConflicts([]);
  }

  function applyProfilePreview(json: ProfilePreview): boolean {
    if (!profilesEnabled) return false;
    if (json.needs_profile_choice) {
      setProfileChoices(json.profiles ?? []);
      setMapping(null);
      return true;
    }
    setProfileChoices(json.applied_profile ? [json.applied_profile] : []);
    setCanSaveProfile(json.can_save_profile === true);
    setAppliedProfile(json.applied_profile?.name ?? null);
    if (json.profile_settings) {
      setDateOrder(json.profile_settings.dateOrder);
      setPositiveIsIncome(json.profile_settings.positiveIsIncome);
      setSkipRows(json.profile_settings.skipRows);
    }
    return false;
  }

  function previewForm(file: File, columnMap?: Record<string, number | null>): FormData {
    const form = new FormData();
    form.set("file", file);
    form.set("positive_is_income", String(positiveIsIncome));
    if (dateOrder !== "auto") form.set("date_order", dateOrder);
    if (profilesEnabled) {
      form.set("skip_rows", String(skipRows));
      if (profileId) form.set("profile_id", profileId);
    }
    if (columnMap) form.set("column_map", JSON.stringify(columnMap));
    return form;
  }

  async function checkFile(form: FormData): Promise<boolean> {
    if (!diagnosticsEnabled) return true;
    setDiagnostics(null);
    const response = await fetch("/api/import/preflight", { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "File check failed");
    if (result.needs_profile_choice) {
      applyProfilePreview(result);
      return false;
    }
    setDiagnostics(result.diagnostics ?? null);
    if (result.needs_mapping) {
      setMapping({ headers: result.headers ?? [], sample: result.sample ?? [] });
      return false;
    }
    return result.diagnostics?.canPreview !== false;
  }

  async function runPreview(file: File, columnMap?: Record<string, number | null>) {
    setBusy(true);
    setError(null);
    setAnnotationConflicts([]);
    setRows([]);
    setBatchId(null);
    setCanSaveProfile(false);
    setAppliedProfile(null);
    setProfileNotice(null);
    try {
      const form = previewForm(file, columnMap);
      if (!await checkFile(form)) return;
      const res = await fetch("/api/import/preview", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Preview failed");
      if (applyProfilePreview(json)) return;
      if (json.needs_date_format) {
        setDateFormatRequired(true);
        setRows([]);
        setBatchId(null);
        return;
      }
      setDateFormatRequired(false);
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
      const importedSourceAccounts = (json.source_accounts ?? []) as string[];
      const persistedMappings = (json.source_account_mappings ?? {}) as Record<string, { account_id?: string; manual_account_id?: string }>;
      setSourceAccounts(importedSourceAccounts);
      setSourceAccountTargets(Object.fromEntries(importedSourceAccounts.map((sourceAccount) => [
        sourceAccount,
        persistedMappings[sourceAccount]?.account_id ?? persistedMappings[sourceAccount]?.manual_account_id ?? (importedSourceAccounts.length === 1 ? accountId : ""),
      ])));
      // Clean rows (no duplicate flags) start selected.
      setSelected(new Set(previewRows.filter((row) => row.flags.length === 0).map((row) => row.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function onPreview(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setCommitted(null);
    setMapping(null);
    setDateFormatRequired(false);
    const fileInput = event.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file || !accountId) {
      setError("Choose a CSV, OFX/QFX, Mint, Monarch, or YNAB file and a target account.");
      return;
    }
    setPendingFile(file);
    await runPreview(file);
  }

  function onApplyMapping(event: React.SyntheticEvent<HTMLFormElement>) {
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
    setAnnotationConflicts([]);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onCommit(
    overwriteAnnotationRowIds?: string[],
    approvedRowIds: ReadonlySet<string> = selected,
  ) {
    if (!batchId) return;
    const selectedAccount = accounts.find((account) => account.id === accountId);
    if (!selectedAccount) return;
    const sourceMappings: Record<string, { account_id?: string; manual_account_id?: string }> = {};
    for (const sourceAccount of sourceAccounts) {
      const target = accounts.find((account) => account.id === sourceAccountTargets[sourceAccount]);
      if (!target) {
        setError(`Choose a FundFlow account for source account "${sourceAccount}"`);
        return;
      }
      sourceMappings[sourceAccount] = target.kind === "manual"
        ? { manual_account_id: target.id }
        : { account_id: target.id };
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          batch_id: batchId,
          save_profile_name: saveProfileName || undefined,
          ...(selectedAccount.kind === "manual" ? { manual_account_id: selectedAccount.id } : { account_id: selectedAccount.id }),
          account_mappings: sourceMappings,
          approved_row_ids: [...approvedRowIds],
          ...(overwriteAnnotationRowIds?.length
            ? { overwrite_annotation_row_ids: overwriteAnnotationRowIds }
            : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      // 409: some rows carry notes/tags that were edited in FundFlow after
      // this batch was staged. Nothing was written; surface the count and let
      // the user decide, rather than leaving them with an unresolvable error.
      if (res.status === 409 && Array.isArray(json.conflicts)) {
        setAnnotationConflicts(json.conflicts as string[]);
        setError(null);
        return;
      }
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setCommitted(json.imported ?? 0);
      setRuleWarning(typeof json.rule_warning === "string" ? json.rule_warning : null);
      setProfileNotice(profileCommitNotice(json));
      setProfileName("");
      setRows([]);
      setBatchId(null);
      setSelected(new Set());
      setSourceAccounts([]);
      setSourceAccountTargets({});
      setAnnotationConflicts([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  /** Re-run the commit, explicitly approving the conflicting rows. */
  async function onOverwriteConflicts() {
    const ids = annotationConflicts;
    setAnnotationConflicts([]);
    await onCommit(ids);
  }

  /** Drop the conflicting rows and immediately commit the remaining selection. */
  async function onSkipConflicts() {
    const conflicting = new Set(annotationConflicts);
    const remaining = new Set([...selected].filter((id) => !conflicting.has(id)));
    setSelected(remaining);
    setAnnotationConflicts([]);
    if (remaining.size > 0) {
      await onCommit([], remaining);
    }
  }

  const selectableCount = rows.filter((row) => selected.has(row.id)).length;
  const headerKeys = uniqueKeys(mapping?.headers ?? [], "header");
  const sampleKeys = uniqueKeys(
    (mapping?.sample ?? []).map((row) => row.join("\u001f")),
    "sample",
  );
  const headerColumns = (mapping?.headers ?? []).map((value, index) => ({
    key: headerKeys[index]!,
    index,
    value,
  }));
  const sampleRows = (mapping?.sample ?? []).map((value, index) => ({
    key: sampleKeys[index]!,
    value,
  }));
  const columnOptions = (placeholder: string, includeNone = false) => (
    <>
      <option value="">{includeNone ? "None" : placeholder}</option>
      {headerColumns.map((column) => (
        <option key={column.key} value={column.index}>
          {column.value || `Column ${column.index + 1}`}
        </option>
      ))}
    </>
  );

  return (
    <Panel title="Import with review" eyebrow="Statement backfill">
      {dropAvailable && <ImportSteps hasFile={pendingFile !== null} hasRows={rows.length > 0} completed={committed !== null} />}
      {dropAvailable && <p className="mb-4 text-sm text-muted">Drop one statement anywhere on this import screen, or use Choose file. Nothing is imported until you review and confirm.</p>}
      {draggingFile && <output className="pointer-events-none fixed inset-4 z-50 flex items-center justify-center rounded-card border-2 border-dashed border-accent bg-panel/95 p-6 text-center font-semibold text-foreground">Drop one statement file to begin review</output>}
      <p className="mb-4 text-sm text-muted">
        Preview a bank-statement CSV, an OFX/QFX file, or a Mint, Monarch, or YNAB export
        before importing. Rows that look like duplicates of existing transactions are
        flagged and left unchecked; you decide what lands.
      </p>
      <p className="mb-4 text-sm text-muted">
        Only transactions import — budgets, goals, and rules from the source app are not
        carried over.
      </p>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted">Create or connect an account first. Imports attach to an account.</p>
      ) : (
        <form onSubmit={onPreview} className="space-y-3 text-sm">
          <Input
            ref={fileInputRef}
            disabled={wizardEnabled && busy}
            type="file"
            name="file"
            aria-label="Statement file"
            accept=".csv,.ofx,.qfx,text/csv,application/x-ofx"
            required
            className="max-w-xs"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              if (wizardEnabled) chooseWizardFile(file);
              else { setPendingFile(file); setDiagnostics(null); }
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              Into account{" "}
              <Select disabled={wizardEnabled && busy} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountDisplayLabel(account.name, account.mask)}{account.kind === "manual" ? " (manual)" : ""}
                  </option>
                ))}
              </Select>
            </label>
            {!pendingFile || !isOfxFileName(pendingFile.name) ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={wizardEnabled && busy}
                  checked={positiveIsIncome}
                  onChange={(event) => changeFileSettings(() => setPositiveIsIncome(event.target.checked))}
                />
                {" "}Positive amounts are deposits
              </label>
            ) : (
              <p className="text-muted">OFX sign conventions are detected automatically.</p>
            )}
            <label className="flex items-center gap-2">
              Date format{" "}
              <select
                disabled={wizardEnabled && busy}
                value={dateOrder}
                onChange={(event) => changeFileSettings(() => setDateOrder(event.target.value as typeof dateOrder))}
                className="rounded border border-panel-border bg-panel px-2 py-1"
              >
                <option value="auto">Auto-detect</option>
                <option value="mdy">Month / day / year</option>
                <option value="dmy">Day / month / year</option>
                <option value="ymd">Year / month / day</option>
              </select>
            </label>
          </div>
          {profilesEnabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                Saved layout
                <Select disabled={wizardEnabled && busy} value={profileId} onChange={event => changeFileSettings(() => setProfileId(event.target.value))}>
                  <option value="">Match automatically</option>
                  <option value="manual">Use current settings</option>
                  {profileChoices.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                Leading rows to skip
                <Input disabled={wizardEnabled && busy} type="number" min={0} max={20} step={1} value={skipRows} onChange={event => changeFileSettings(() => setSkipRows(Number(event.target.value)))} />
              </label>
              <p className="text-muted sm:col-span-2">Saved layouts include the date format, amount signs, and columns. Every file is reviewed before import.</p>
              {profileChoices.length > 1 && <output className="block sm:col-span-2">Several layouts match. Choose a saved layout or use your settings, then preview again.</output>}
            </div>
          )}
          {dateFormatRequired && (
            <p className="text-sm text-warning">
              The file contains ambiguous dates. Choose the source date format, then preview again.
            </p>
          )}
          <Button type="submit" loading={busy} variant="secondary">
            Preview file
          </Button>
        </form>
      )}

      {diagnosticsEnabled && diagnostics && <ImportDiagnostics report={diagnostics} />}

      {sourceAccounts.length > 0 && (
        <div className="mt-4 space-y-3 rounded-field border border-panel-border bg-panel-2 p-3 text-sm">
          <p className="font-semibold text-foreground">Map source accounts</p>
          <p className="text-muted">Each source account is remembered for future imports.</p>
          {sourceAccounts.map((sourceAccount) => (
            <label key={sourceAccount} className="flex flex-wrap items-center justify-between gap-2">
              <span>{sourceAccount}</span>
              <Select
                value={sourceAccountTargets[sourceAccount] ?? ""}
                onChange={(event) => setSourceAccountTargets((current) => ({ ...current, [sourceAccount]: event.target.value }))}
              >
                <option value="">Choose account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountDisplayLabel(account.name, account.mask)}{account.kind === "manual" ? " (manual)" : ""}
                  </option>
                ))}
              </Select>
            </label>
          ))}
        </div>
      )}

      {mapping && (
        <form onSubmit={onApplyMapping} className="mt-4 space-y-3 rounded-field border border-panel-border bg-panel-2 p-3 text-sm">
          {wizardEnabled && <h3 ref={mappingFocusRef} tabIndex={-1} className="font-semibold outline-offset-4">Map file columns</h3>}
          <p className="text-muted">
            We couldn&apos;t auto-detect the columns. Map them manually, then preview again.
          </p>
          {mapping.sample.length > 0 && (
            <div className="overflow-x-auto rounded-field border border-panel-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-panel text-muted">
                  <tr>
                    {headerColumns.map((column) => (
                      <th key={column.key} className="whitespace-nowrap p-2 font-semibold">
                        {column.value || `Column ${column.index + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((sample) => (
                    <tr key={sample.key} className="border-t border-panel-border">
                      {headerColumns.map((column) => (
                        <td key={column.key} className="whitespace-nowrap p-2 text-muted">
                          {sample.value[column.index] ?? ""}
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
              <Select disabled={wizardEnabled && busy} value={mapDate} onChange={(e) => setMapDate(e.target.value)}>
                {columnOptions("Select column")}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              Description column
              <Select disabled={wizardEnabled && busy} value={mapDescription} onChange={(e) => setMapDescription(e.target.value)}>
                {columnOptions("Select column")}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              Amount format
              <Select disabled={wizardEnabled && busy} value={amountMode} onChange={(e) => setAmountMode(e.target.value as "single" | "split")}>
                <option value="single">One signed amount column</option>
                <option value="split">Separate debit / credit columns</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              Category column <span className="text-muted">(optional)</span>
              <Select disabled={wizardEnabled && busy} value={mapCategory} onChange={(e) => setMapCategory(e.target.value)}>
                {columnOptions("None", true)}
              </Select>
            </label>
            {amountMode === "single" ? (
              <label className="flex flex-col gap-1">
                Amount column
                <Select disabled={wizardEnabled && busy} value={mapAmount} onChange={(e) => setMapAmount(e.target.value)}>
                  {columnOptions("Select column")}
                </Select>
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  Debit (money out) column
                  <Select disabled={wizardEnabled && busy} value={mapDebit} onChange={(e) => setMapDebit(e.target.value)}>
                    {columnOptions("None", true)}
                  </Select>
                </label>
                <label className="flex flex-col gap-1">
                  Credit (money in) column
                  <Select disabled={wizardEnabled && busy} value={mapCredit} onChange={(e) => setMapCredit(e.target.value)}>
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
          {wizardEnabled && <>
            <h3 ref={reviewFocusRef} tabIndex={-1} className="font-semibold outline-offset-4">Review selected transactions</h3>
            <p className="text-sm text-muted">Positive amounts below are money out; negative amounts are money in.</p>
          </>}
          {profilesEnabled && (
            <div className="space-y-2 text-sm">
              {appliedProfile && <output className="block">Applied saved layout: {appliedProfile}</output>}
              {canSaveProfile ? (
                <label className="flex max-w-sm flex-col gap-1">
                  Save layout as (optional)
                  <Input disabled={wizardEnabled && busy} value={profileName} maxLength={80} onChange={event => setProfileName(event.target.value)} aria-describedby="import-layout-help" />
                  <span id="import-layout-help" className="text-muted">Saved only after a successful import. Use a different name for each layout.</span>
                </label>
              ) : <p className="text-muted">To save a bank CSV layout, choose an explicit date format and preview again.</p>}
            </div>
          )}
          <div className="max-h-72 overflow-auto rounded-field border border-panel-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-panel-2 text-muted">
                <tr>
                  <th className="p-2"><span className="sr-only">Include</span></th>
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
                        aria-label={`Import ${row.description} on ${row.date}`}
                        disabled={wizardEnabled && busy}
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
          <Button
            type="button"
            onClick={() => {
              void onCommit();
            }}
            loading={busy}
            disabled={selectableCount === 0}
          >
            Import {selectableCount} selected
          </Button>
          {annotationConflicts.length > 0 && (
            <div className="mt-3 rounded-field border border-warning/30 bg-warning/10 p-3 text-sm">
              <p className="font-semibold">
                {annotationConflicts.length} row
                {annotationConflicts.length === 1 ? " was" : "s were"} edited in
                FundFlow after this file was staged.
              </p>
              <p className="mt-1 text-muted">
                Nothing has been imported yet. Keep your FundFlow notes and tags
                by skipping those rows, or let the file overwrite them.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void onSkipConflicts();
                  }}
                  disabled={busy}
                >
                  Skip those rows
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    void onOverwriteConflicts();
                  }}
                  loading={busy}
                >
                  Overwrite with imported notes
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {committed !== null && (
        <output ref={completeFocusRef} tabIndex={wizardEnabled ? -1 : undefined} className="mt-3 block text-sm text-success outline-offset-4">
          Imported {committed} transaction{committed === 1 ? "" : "s"}.
        </output>
      )}
      {ruleWarning && <p role="alert" className="mt-3 text-sm text-warning">{ruleWarning}</p>}
      {profileNotice && <output className="mt-3 block text-sm text-muted">{profileNotice}</output>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Panel>
  );
}
