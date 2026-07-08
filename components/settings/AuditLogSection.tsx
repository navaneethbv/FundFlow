"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

interface AuditRow {
  action: string;
  metadata: Record<string, unknown>;
}

export default function AuditLogSection({ initialRows }: { initialRows: AuditRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [status, setStatus] = useState<string | null>(null);

  async function refresh() {
    setStatus(null);
    const res = await fetch("/api/settings/audit");
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(json.error ?? "Could not load audit log.");
      return;
    }
    setRows(json.rows ?? []);
    setStatus("Audit log refreshed.");
  }

  return (
    <Panel title="Audit log" eyebrow="Account history">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No account activity has been recorded yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.slice(0, 5).map((row, index) => (
            <li key={`${row.action}-${index}`} className="rounded-field bg-panel-2 p-3">
              <span className="font-semibold">{row.action}</span>
              <span className="ml-2 text-xs text-muted">{Object.keys(row.metadata).join(", ") || "no metadata"}</span>
            </li>
          ))}
        </ul>
      )}
      <Button className="mt-4" variant="secondary" onClick={refresh}>
        Refresh audit log
      </Button>
      {status && <p className="mt-3 text-sm text-muted">{status}</p>}
    </Panel>
  );
}
