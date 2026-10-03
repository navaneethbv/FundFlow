"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_WIDGET_ORDER,
  DEFAULT_WIDGET_SIZES,
  mergeWidgetPrefs,
  WIDGET_SIZE_KEYS,
  WIDGET_DEFINITIONS,
  withWidgetSize,
  type WidgetSize,
  type DashboardWidgetPrefs,
  type WidgetKey,
} from "@/lib/dashboard-widgets";

/**
 * Show, hide, reorder, and size dashboard widgets.
 *
 * Up/down buttons remain the keyboard path. The optional drag path is an
 * enhancement for pointer users, never the only way to arrange the list.
 *
 * The save is optimistic with an explicit rollback — the grid re-renders from
 * the server after `router.refresh()`, so leaving local state ahead of a failed
 * write would show a layout the database does not have.
 *
 * Renders as a modal overlay (the same `bg-black/60` + `rounded-card` +
 * `shadow-float` recipe via `Modal`) rather than an inline-expanding section,
 * specifically so the trigger — Monarch's "Customize" white pill — can sit in
 * the page header without its open panel pushing header content around.
 */
export default function CustomizeDrawer({
  initialPrefs,
  advancedLayout = false,
}: Readonly<{
  initialPrefs: DashboardWidgetPrefs;
  advancedLayout?: boolean;
}>) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<DashboardWidgetPrefs>(initialPrefs);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draggingKey, setDraggingKey] = useState<WidgetKey | null>(null);

  function move(key: WidgetKey, delta: -1 | 1) {
    setPrefs((current) => {
      const order = [...current.order];
      const index = order.indexOf(key);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= order.length) return current;
      const currentKey = order[index];
      const nextKey = order[next];
      if (!currentKey || !nextKey) return current;
      order.splice(index, 1, nextKey);
      order.splice(next, 1, currentKey);
      return { ...current, order };
    });
  }

  function moveBefore(source: WidgetKey, target: WidgetKey) {
    if (source === target) return;
    setPrefs((current) => {
      const remaining = current.order.filter((key) => key !== source);
      const targetIndex = remaining.indexOf(target);
      if (targetIndex < 0) return current;
      remaining.splice(targetIndex, 0, source);
      return { ...current, order: remaining };
    });
  }

  function toggle(key: WidgetKey) {
    setPrefs((current) => ({
      ...current,
      hidden: current.hidden.includes(key)
        ? current.hidden.filter((entry) => entry !== key)
        : [...current.hidden, key],
    }));
  }

  function restoreDefaults() {
    setPrefs({
      order: [...DEFAULT_WIDGET_ORDER],
      hidden: [],
      sizes: DEFAULT_WIDGET_SIZES.map((entry) => ({ ...entry })),
    });
  }

  function resize(key: WidgetKey, size: WidgetSize) {
    setPrefs((current) => withWidgetSize(current, key, size));
  }

  function close() {
    setPrefs(initialPrefs);
    setError(null);
    setOpen(false);
  }

  async function save() {
    setError(null);
    setBusy(true);
    const rollback = prefs;
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError("Sign in again to save your layout.");
        return;
      }
      // Read immediately before writing and merge, rather than overwriting the
      // column with a render-time snapshot: `sidebarCollapsed`, the legacy
      // hide flags, and hidden account ids all live in the same JSON and are
      // written by other components.
      const { data: profile, error: readError } = await supabase
        .from("profiles")
        .select("dashboard_prefs")
        .eq("id", userData.user.id)
        .maybeSingle();
      if (readError) {
        setError(readError.message);
        return;
      }

      const { error: writeError } = await supabase
        .from("profiles")
        .update({
          dashboard_prefs: mergeWidgetPrefs(profile?.dashboard_prefs, prefs),
        })
        .eq("id", userData.user.id);
      if (writeError) {
        setPrefs(rollback);
        setError(writeError.message);
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setPrefs(rollback);
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Customize
      </Button>
      <Modal
        open={open}
        onClose={close}
        placement="sheet"
        titleId="customize-widgets-title"
        className="max-h-[90vh] max-w-lg overflow-y-auto"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="customize-widgets-title" className="text-xl font-bold">
            Customize widgets
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={restoreDefaults}>
            Restore defaults
          </Button>
        </div>

        <ul className="mt-4 space-y-2">
          {prefs.order.map((key, index) => {
            const definition = WIDGET_DEFINITIONS[key];
            const hidden = prefs.hidden.includes(key);
            return (
              <li
                key={key}
                draggable={advancedLayout}
                onDragStart={(event) => {
                  if (!advancedLayout) return;
                  event.dataTransfer.effectAllowed = "move";
                  setDraggingKey(key);
                }}
                onDragOver={(event) => {
                  if (!advancedLayout || !draggingKey || draggingKey === key) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  if (!advancedLayout || !draggingKey) return;
                  event.preventDefault();
                  moveBefore(draggingKey, key);
                  setDraggingKey(null);
                }}
                onDragEnd={() => setDraggingKey(null)}
                className="flex flex-wrap items-center gap-2 border-t border-panel-border pt-2 first:border-t-0 first:pt-0"
              >
                <label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={definition.label}
                    className="mt-1"
                    checked={!hidden}
                    onChange={() => toggle(key)}
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold">{definition.label}</span>
                    <span className="block text-xs text-muted">{definition.hint}</span>
                  </span>
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => move(key, -1)}
                >
                  <span aria-hidden>↑</span>
                  <span className="sr-only">Move {definition.label} up</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={index === prefs.order.length - 1}
                  onClick={() => move(key, 1)}
                >
                  <span aria-hidden>↓</span>
                  <span className="sr-only">Move {definition.label} down</span>
                </Button>
                {advancedLayout && (
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <span>Size</span>
                    <select
                      aria-label={`${definition.label} size`}
                      className="min-h-9 rounded-field border border-panel-border bg-panel px-2 text-foreground"
                      value={prefs.sizes?.find((entry) => entry.key === key)?.size ?? "standard"}
                      onChange={(event) => resize(key, event.target.value as WidgetSize)}
                    >
                      {WIDGET_SIZE_KEYS.map((size) => (
                        <option key={size} value={size}>
                          {size[0]?.toUpperCase()}{size.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </li>
            );
          })}
        </ul>

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-panel-border pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save layout"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
