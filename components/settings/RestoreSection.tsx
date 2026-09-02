"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

interface RestorePlanTable {
  name: string;
  rowCount: number;
}

interface RestorePlan {
  tables: RestorePlanTable[];
  unknownKeys: string[];
  missingTables: string[];
  totalRows: number;
}

interface RestoreResult {
  tables: Array<{ name: string; rowsWritten: number }>;
  skipped: Array<{ name: string; reason: string }>;
  failedTable: string | null;
  regeneratedIds: number;
}

type Stage = "pick" | "preview" | "confirm" | "done";

/**
 * Settings → Data: restore an encrypted backup archive (the `.json.enc` file
 * the monthly backup email attaches). Flow: pick file → step-up code → dry-run
 * preview → explicit confirm → result. Restoring replaces the affected
 * tables' data, so nothing happens without the preview and a second click.
 */
export default function RestoreSection() {
  const [stage, setStage] = useState<Stage>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(next: File | null) {
    setFile(next);
    setPlan(null);
    setResult(null);
    setStage("pick");
    setError(null);
  }

  async function submit(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("dry_run", dryRun ? "true" : "false");
      form.set("code", code);
      const res = await fetch("/api/backup/restore", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        plan?: RestorePlan;
        result?: RestoreResult;
      };
      if (!res.ok) {
        setError(json.error ?? "Could not process the archive.");
        return;
      }
      if (json.plan) {
        setPlan(json.plan);
        setStage("preview");
      } else if (json.result) {
        setResult(json.result);
        setStage("done");
      }
    } catch {
      setError("Could not process the archive.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Restore a backup" eyebrow="Data">
      <p className="mb-4 text-sm text-muted">
        Upload the encrypted backup archive from your monthly backup email to bring your
        data back into FundFlow. Restoring replaces the current data in the affected
        tables and cannot be undone.
      </p>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block font-medium">Backup archive (.json.enc)</span>
        <input
          type="file"
          accept=".enc,application/json"
          onChange={(event) => pick(event.target.files?.[0] ?? null)}
          className="text-sm"
        />
      </label>

      {(stage === "preview" || stage === "confirm") && (
        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium">Verification code or password</span>
          <input
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="min-h-11 w-full max-w-xs rounded-field border border-panel-border bg-background px-3 text-foreground"
            autoComplete="off"
          />
        </label>
      )}

      {stage === "preview" && plan && (
        <div className="mb-4 rounded-field border border-panel-border p-3">
          <p className="text-sm font-semibold">
            {plan.totalRows} rows across {plan.tables.filter((t) => t.rowCount > 0).length} tables
          </p>
          <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-sm text-muted">
            {plan.tables
              .filter((table) => table.rowCount > 0)
              .map((table) => (
                <li key={table.name}>
                  {table.name}: {table.rowCount} row{table.rowCount === 1 ? "" : "s"}
                </li>
              ))}
          </ul>
          {plan.unknownKeys.length > 0 && (
            <p className="mt-2 text-xs text-warning">
              Ignored unrecognized sections: {plan.unknownKeys.join(", ")}
            </p>
          )}
          <p className="mt-2 text-sm font-semibold text-danger">
            Continuing replaces your current data in these tables. This cannot be undone.
          </p>
        </div>
      )}

      {stage === "done" && result && (
        <div className="mb-4 rounded-field border border-panel-border p-3 text-sm">
          {result.failedTable ? (
            <p className="font-semibold text-danger">
              Restore stopped at “{result.failedTable}”. Earlier tables were restored.
            </p>
          ) : (
            <p className="font-semibold">
              Restored {result.tables.reduce((sum, table) => sum + table.rowsWritten, 0)} rows.
            </p>
          )}
          {result.regeneratedIds > 0 && (
            <p className="mt-1 text-muted">
              {result.regeneratedIds} transaction{result.regeneratedIds === 1 ? "" : "s"} from an
              older archive format received a new id.
            </p>
          )}
          {result.skipped.length > 0 && (
            <p className="mt-1 text-muted">
              Skipped: {result.skipped.map((entry) => entry.name).join(", ")}.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {stage === "preview" && (
          <Button onClick={() => setStage("confirm")} disabled={!file}>
            Preview restore
          </Button>
        )}
        {stage === "confirm" && (
          <>
            <Button variant="ghost" onClick={() => setStage("preview")}>
              Back
            </Button>
            <Button variant="danger" onClick={() => void submit(false)} loading={busy}>
              Restore now
            </Button>
          </>
        )}
        {stage === "done" && (
          <Button variant="ghost" onClick={() => setStage("pick")}>
            Restore another archive
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </Panel>
  );
}
