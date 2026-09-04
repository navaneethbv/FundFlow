"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import {
  persistAccountPreferences,
  type AccountsPagePreferences,
} from "@/lib/account-preferences";

export type { AccountsPagePreferences } from "@/lib/account-preferences";

export default function AccountPreferences({
  accounts,
  initialPrefs,
}: Readonly<{
  accounts: Array<{ id: string; name: string }>;
  initialPrefs: AccountsPagePreferences;
}>) {
  const supabase = createClient();
  const initialOrder = initialPrefs.order?.length
    ? initialPrefs.order
    : accounts.map((account) => account.id);
  const [prefs, setPrefs] = useState<AccountsPagePreferences>({
    hiddenIds: initialPrefs.hiddenIds ?? [],
    order: initialOrder,
  });
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function move(id: string, delta: -1 | 1) {
    setPrefs((current) => {
      const order = [...(current.order ?? [])];
      const index = order.indexOf(id);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= order.length) return current;
      [order[index], order[next]] = [order[next]!, order[index]!];
      return { ...current, order };
    });
  }

  function toggleHidden(id: string) {
    setPrefs((current) => {
      const hidden = new Set(current.hiddenIds ?? []);
      if (hidden.has(id)) hidden.delete(id);
      else hidden.add(id);
      return { ...current, hiddenIds: [...hidden] };
    });
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      await persistAccountPreferences(supabase, prefs);
      setStatus("Account preferences saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save account preferences.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="rounded-card border border-panel-border bg-panel shadow-card">
      <summary className="min-h-14 cursor-pointer px-4 py-4 text-sm font-semibold focus-visible:outline-2">
        Account visibility and order
      </summary>
      <div className="space-y-2 border-t border-panel-border p-4">
        {accounts.map((account) => {
          const hidden = prefs.hiddenIds?.includes(account.id) ?? false;
          return (
            <div
              key={account.id}
              className="flex flex-col gap-2 rounded-field bg-panel-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm font-semibold">{account.name}</span>
              <span className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move ${account.name} up`}
                  onClick={() => move(account.id, -1)}
                >
                  Up
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move ${account.name} down`}
                  onClick={() => move(account.id, 1)}
                >
                  Down
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => toggleHidden(account.id)}
                >
                  {hidden ? "Show" : "Hide"}
                </Button>
              </span>
            </div>
          );
        })}
        <Button onClick={save} loading={saving}>Save preferences</Button>
        {status && <p className="text-sm text-muted">{status}</p>}
      </div>
    </details>
  );
}
