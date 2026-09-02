"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import { formatMonth } from "@/lib/format";
import { LayoutDashboard } from "@/components/ui/icons";
import type { BudgetGroup } from "@/lib/budget-page";

interface TemplateItem {
  category: string;
  group_name: BudgetGroup;
  planned: number;
  rollover_enabled: boolean;
}

interface Template {
  id: string;
  name: string;
  items: TemplateItem[];
  createdAt: string;
}

interface MonthNotEmptyBody {
  error: "month_not_empty";
  existing_count: number;
  source_count: number;
}

/**
 * Saved budget templates (features.md #4): save the viewed month's planned
 * amounts as a named template, or apply a saved one to the viewed month.
 * Applying into a month that already has envelopes makes the user choose
 * "fill empty only" or "overwrite all" — never a silent replace.
 */
export default function BudgetTemplateButton({
  month,
  currentLines,
}: Readonly<{
  month: string;
  currentLines: ReadonlyArray<{
    category: string;
    group: BudgetGroup;
    basePlanned: number;
    rolloverEnabled: boolean;
  }>;
}>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [saveName, setSaveName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ templateId: string; body: MonthNotEmptyBody } | null>(
    null,
  );

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/budget/templates");
      const payload = (await response.json().catch(() => null)) as
        | { templates?: Template[] }
        | null;
      setTemplates(payload?.templates ?? []);
    } catch {
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/budget/templates")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((payload) => {
        if (cancelled) return;
        setTemplates(((payload ?? {}) as { templates?: Template[] }).templates ?? []);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function saveCurrentMonth() {
    const name = saveName.trim();
    if (!name) {
      setError("Give the template a name.");
      return;
    }
    const items = currentLines
      .filter((line) => line.basePlanned > 0)
      .map((line) => ({
        category: line.category,
        group_name: line.group,
        planned: line.basePlanned,
        rollover_enabled: line.rolloverEnabled,
      }));
    if (items.length === 0) {
      setError("The current month has no planned amounts to save.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/budget/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, items }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not save the template.");
        return;
      }
      setSaveName("");
      setStatus(`Saved "${name}".`);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function apply(templateId: string, mode?: "merge" | "overwrite") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/budget/templates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode ? { template_id: templateId, month, mode } : { template_id: templateId, month }),
      });
      if (response.status === 409) {
        const body = (await response.json()) as MonthNotEmptyBody;
        setConflict({ templateId, body });
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        applied?: number;
        unmatched?: string[];
      };
      if (!response.ok) {
        setError(payload.error ?? "Could not apply the template.");
        return;
      }
      const unmatchedNote =
        payload.unmatched && payload.unmatched.length > 0
          ? ` (${payload.unmatched.length} categor${payload.unmatched.length === 1 ? "y" : "ies"} had no matching budget row)`
          : "";
      setStatus(`Applied ${payload.applied ?? 0} planned amount(s) to ${formatMonth(month)}.${unmatchedNote}`);
      setConflict(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(templateId: string) {
    setBusy(true);
    try {
      await fetch(`/api/budget/templates?id=${encodeURIComponent(templateId)}`, {
        method: "DELETE",
      });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-field border border-panel-border px-4 text-sm font-semibold text-foreground hover:bg-panel-hover"
        >
          <LayoutDashboard aria-hidden className="h-4 w-4" />
          Templates
        </button>
        {(status || error) && (
          <p
            role={error ? "alert" : "status"}
            className={`text-sm ${error ? "font-medium text-danger" : "text-muted"}`}
          >
            {error ?? status}
          </p>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        titleId="budget-templates-title"
        className="max-h-[90vh] max-w-lg overflow-y-auto"
      >
        <h2 id="budget-templates-title" className="text-xl font-bold">
          Budget templates
        </h2>
        <p className="mt-1 text-sm text-muted">
          Save {formatMonth(month)}&apos;s planned amounts as a reusable starting point, or
          apply a saved template to it.
        </p>

        <div className="mt-5 space-y-3">
          {(templates ?? []).map((template) => (
            <div
              key={template.id}
              className="flex items-center justify-between gap-3 rounded-field border border-panel-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{template.name}</p>
                <p className="text-xs text-muted">
                  {template.items.length} categor{template.items.length === 1 ? "y" : "ies"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void apply(template.id)}
                  className="min-h-11 rounded-field bg-accent px-4 text-sm font-bold text-accent-foreground disabled:opacity-50"
                >
                  Apply
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(template.id)}
                  className="min-h-11 rounded-field px-3 text-sm font-semibold text-muted hover:bg-panel-hover"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {templates !== null && templates.length === 0 && (
            <p className="text-sm text-muted">No saved templates yet.</p>
          )}
        </div>

        <div className="mt-5 rounded-field border border-panel-border p-4">
          <p className="text-sm font-semibold">Save {formatMonth(month)} as a template</p>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              placeholder="Template name"
              maxLength={120}
              className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3 text-sm text-foreground"
            />
            <button
              type="button"
              onClick={() => void saveCurrentMonth()}
              disabled={busy}
              className="min-h-11 shrink-0 rounded-field bg-accent-soft px-4 text-sm font-semibold text-accent disabled:opacity-50"
            >
              Save
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-11 rounded-field px-4 text-sm font-semibold text-muted hover:bg-panel-hover"
          >
            Close
          </button>
        </div>
      </Modal>

      <Modal
        open={conflict !== null}
        onClose={() => setConflict(null)}
        titleId="budget-template-conflict-title"
        className="max-w-lg"
      >
        <h2 id="budget-template-conflict-title" className="text-xl font-bold">
          {formatMonth(month)} already has planned amounts
        </h2>
        <p className="mt-2 text-sm text-muted">
          {conflict?.body.existing_count} envelope
          {conflict?.body.existing_count === 1 ? "" : "s"} already{" "}
          {conflict?.body.existing_count === 1 ? "has" : "have"} planned amounts. How should the
          template be applied?
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => setConflict(null)}
            className="min-h-11 rounded-field px-4 text-sm font-semibold text-muted hover:bg-panel-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => conflict && void apply(conflict.templateId, "merge")}
            disabled={busy}
            className="min-h-11 rounded-field border border-panel-border px-4 text-sm font-semibold text-foreground hover:bg-panel-hover disabled:opacity-50"
          >
            Fill empty only
          </button>
          <button
            type="button"
            onClick={() => conflict && void apply(conflict.templateId, "overwrite")}
            disabled={busy}
            className="min-h-11 rounded-field bg-accent px-4 text-sm font-bold text-accent-foreground disabled:opacity-50"
          >
            Overwrite all
          </button>
        </div>
      </Modal>
    </>
  );
}
