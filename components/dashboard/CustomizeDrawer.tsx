"use client";

import { useState } from "react";
import { WIDGET_KEYS, type WidgetKey, type DashboardWidgetPrefs } from "@/lib/dashboard-widgets";
import { titleCase } from "@/lib/format";

export default function CustomizeDrawer({
  prefs,
}: Readonly<{
  prefs: DashboardWidgetPrefs;
}>) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<WidgetKey>>(new Set(prefs.hidden));
  const [loading, setLoading] = useState(false);

  const toggleHide = (key: WidgetKey) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await fetch("/api/dashboard/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: prefs.order,
          hidden: Array.from(hidden),
        }),
      });
      window.location.reload();
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-field border border-panel-border bg-panel px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-panel-hover"
      >
        ⚙ Customize Layout
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40">
      <div className="h-full w-full max-w-sm border-l border-panel-border bg-panel p-6 space-y-6 overflow-y-auto">
        <div className="flex items-center justify-between border-b border-panel-border pb-4">
          <h3 className="text-lg font-bold text-foreground">Customize Grid</h3>
          <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-foreground">
            Close
          </button>
        </div>

        <div className="space-y-3">
          <p className="text-xs text-muted">Toggle visibility of dashboard widgets:</p>
          {WIDGET_KEYS.map((key) => {
            const isVisible = !hidden.has(key);
            return (
              <div
                key={key}
                className="flex items-center justify-between rounded-field border border-panel-border bg-background p-3 text-xs"
              >
                <span className="font-semibold text-foreground">{titleCase(key)}</span>
                <button
                  onClick={() => toggleHide(key)}
                  className={`rounded px-2.5 py-1 font-semibold ${
                    isVisible ? "bg-accent/10 text-accent" : "bg-panel-border text-muted"
                  }`}
                >
                  {isVisible ? "Visible" : "Hidden"}
                </button>
              </div>
            );
          })}
        </div>

        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full rounded bg-accent py-2 text-xs font-semibold text-white hover:bg-accent/90"
        >
          Save Layout
        </button>
      </div>
    </div>
  );
}
