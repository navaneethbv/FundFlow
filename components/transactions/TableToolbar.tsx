"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

type Panel = "none" | "edit" | "columns";

/**
 * The row of toolbar triggers above the ledger table — "Edit multiple" and
 * "Columns" collapse `BulkTagBar`/`ColumnsMenu` behind a pill trigger
 * instead of showing both bars unconditionally, matching Monarch's compact
 * toolbar. Both panels are passed in as already-rendered nodes (built in the
 * server page) rather than imported here, so this stays a thin client
 * shell around server-fetched content — the standard Server/Client
 * composition pattern, not a prop a Client Component could construct itself.
 */
export default function TableToolbar({
  bulkTagBar,
  columnsMenu,
  sortMenu,
}: Readonly<{ bulkTagBar: React.ReactNode; columnsMenu?: React.ReactNode; sortMenu?: React.ReactNode }>) {
  const [open, setOpen] = useState<Panel>("none");

  function toggle(panel: Panel) {
    setOpen((current) => (current === panel ? "none" : panel));
  }

  function triggerClass(panel: Panel) {
    return cn(
      "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition-colors duration-150 focus-visible:outline-2",
      open === panel
        ? "border-accent/40 bg-accent-soft text-accent"
        : "border-panel-border bg-panel text-foreground shadow-sm hover:border-accent/40",
    );
  }

  return (
    <div className="border-b border-panel-border px-4 py-2 sm:px-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {sortMenu}
        <button type="button" onClick={() => toggle("edit")} className={triggerClass("edit")}>
          Edit multiple
        </button>
        {columnsMenu && (
          <button type="button" onClick={() => toggle("columns")} className={triggerClass("columns")}>
            Columns
          </button>
        )}
      </div>
      {open === "edit" && <div className="mt-3">{bulkTagBar}</div>}
      {open === "columns" && columnsMenu && <div className="mt-3">{columnsMenu}</div>}
    </div>
  );
}
