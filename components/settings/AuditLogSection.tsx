"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import { formatTimestampUtc } from "@/lib/format-date";

interface AuditRow {
  action: string;
  metadata: Record<string, unknown>;
  createdAt?: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  login: "Signed in",
  logout: "Signed out",
  signup: "Account created",
  mfa_enroll: "MFA factor enrolled",
  mfa_unenroll: "MFA factor removed",
  mfa_verify: "MFA verified",
  passkey_register: "Passkey registered",
  passkey_delete: "Passkey deleted",
  plaid_connect: "Bank connected",
  plaid_disconnect: "Bank disconnected",
  plaid_reconnect: "Bank reconnected",
  plaid_repair: "Bank repaired",
  data_refresh: "Bank data refreshed",
  data_export: "Data exported",
  data_import: "Data imported",
  data_backup: "Backup created",
  account_delete: "Account deletion requested",
  receipt_scanned: "Receipt scanned",
  receipt_uploaded: "Receipt uploaded",
  ai_question: "Asked spending question",
  household_invite_sent: "Household invitation sent",
  household_invite_accepted: "Household invitation accepted",
  calendar_token_created: "Calendar token created",
  calendar_token_revoked: "Calendar token revoked",
};

function formatActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatPrimitive(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[complex value]";
  }
}

function formatMetadataSummary(metadata: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const inst = formatPrimitive(metadata.institution);
  if (inst) parts.push(inst);
  const format = formatPrimitive(metadata.format);
  if (format) parts.push(`Format: ${format}`);
  const count = formatPrimitive(metadata.count);
  if (count !== null) parts.push(`${count} items`);
  const rows = formatPrimitive(metadata.rows);
  if (rows !== null) parts.push(`${rows} rows`);
  const status = formatPrimitive(metadata.status);
  if (status) parts.push(`Status: ${status}`);
  if (parts.length > 0) return parts.join(" · ");

  const entries = Object.entries(metadata).filter(
    ([k]) => !k.toLowerCase().includes("token") && !k.toLowerCase().includes("secret"),
  );
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}: ${formatMetadataValue(v)}`).join(" · ");
}

export default function AuditLogSection({ initialRows }: Readonly<{ initialRows: AuditRow[] }>) {
  const [rows, setRows] = useState(initialRows);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    setStatus(null);
    try {
      const res = await fetch("/api/settings/audit");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(json.error ?? "Could not load audit log.");
        return;
      }
      setRows(json.rows ?? []);
      setStatus("Audit log refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Panel title="Audit log" eyebrow="Account history">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No account activity has been recorded yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.slice(0, 5).map((row, index) => {
            const summary = formatMetadataSummary(row.metadata);
            return (
              <li key={`${row.action}-${row.createdAt ?? index}`} className="rounded-field bg-panel-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">{formatActionLabel(row.action)}</span>
                  <span className="text-xs text-muted font-mono">{row.action}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {row.createdAt ? (
                    <time dateTime={row.createdAt}>{formatTimestampUtc(row.createdAt)}</time>
                  ) : (
                    "Unknown time"
                  )}
                </p>
                {summary && (
                  <p className="mt-1 text-xs text-muted">
                    {summary}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Button className="mt-4" variant="secondary" onClick={refresh} loading={refreshing}>
        Refresh audit log
      </Button>
      {status && <p className="mt-3 text-sm text-muted">{status}</p>}
    </Panel>
  );
}
