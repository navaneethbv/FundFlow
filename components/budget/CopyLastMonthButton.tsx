"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Repeat } from "@/components/ui/icons";
import Modal from "@/components/ui/Modal";
import { formatMonth } from "@/lib/format";
import { previousMonth } from "@/lib/budget-copy";

interface MonthNotEmptyBody {
  error: "month_not_empty";
  existing_count: number;
  source_count: number;
}

type CopySuccess = { copied: number; skipped_existing: number; source_count: number };

/**
 * "Copy last month": seeds the viewed month's planned amounts from the
 * previous month. When the target month already has envelopes, the route
 * answers 409 and this dialog makes the overwrite-vs-merge choice explicit —
 * nothing is ever replaced without a confirmation.
 */
export default function CopyLastMonthButton({
  month,
}: Readonly<{ month: string }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<MonthNotEmptyBody | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previous = previousMonth(month);

  async function copy(mode?: "merge" | "overwrite"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/budget/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode ? { month, mode } : { month }),
      });
      if (response.status === 409) {
        const body = (await response.json()) as MonthNotEmptyBody;
        setConflict(body);
        return;
      }
      if (!response.ok) {
        setError("Could not copy last month's budget. Try again.");
        return;
      }
      const body = (await response.json()) as CopySuccess;
      if (body.copied === 0) {
        setStatus(
          `Nothing to copy — ${formatMonth(previous)} has no planned amounts.`,
        );
      } else {
        setStatus(
          `Copied ${body.copied} planned amount${body.copied === 1 ? "" : "s"} from ${formatMonth(previous)}.`,
        );
      }
      setConflict(null);
      router.refresh();
    } catch {
      setError("Could not copy last month's budget. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => void copy()}
          disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-field border border-panel-border px-4 text-sm font-semibold text-foreground hover:bg-panel-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Repeat aria-hidden className="h-4 w-4" />
          {busy ? "Copying..." : "Copy last month"}
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
        open={conflict !== null}
        onClose={() => {
          setConflict(null);
        }}
        titleId="budget-copy-conflict-title"
        className="max-w-lg"
      >
        <h2 id="budget-copy-conflict-title" className="text-xl font-bold">
          {formatMonth(month)} already has planned amounts
        </h2>
        <p className="mt-2 text-sm text-muted">
          {conflict?.existing_count} envelope{conflict?.existing_count === 1 ? "" : "s"}{" "}
          already {conflict?.existing_count === 1 ? "has" : "have"} planned amounts, and{" "}
          {formatMonth(previous)} has {conflict?.source_count ?? 0} to copy. How should
          they be combined?
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setConflict(null);
            }}
            className="min-h-11 rounded-field px-4 text-sm font-semibold text-muted hover:bg-panel-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void copy("merge")}
            disabled={busy}
            className="min-h-11 rounded-field border border-panel-border px-4 text-sm font-semibold text-foreground hover:bg-panel-hover disabled:opacity-50"
          >
            Fill empty only
          </button>
          <button
            type="button"
            onClick={() => void copy("overwrite")}
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
