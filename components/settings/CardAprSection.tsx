"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

interface CreditAccount {
  id: string;
  name: string | null;
  mask: string | null;
  apr: number | null;
}

/**
 * Card APRs feed the debt payoff planner (1.10). Plaid's transactions
 * product doesn't provide rates, so the user enters them once here.
 */
export default function CardAprSection({
  initialAccounts,
}: {
  initialAccounts: CreditAccount[];
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  if (accounts.length === 0) return null;

  async function save(accountId: string) {
    setStatus(null);
    const raw = drafts[accountId]?.trim();
    const apr = raw === "" || raw === undefined ? null : Number(raw);
    if (apr !== null && (!Number.isFinite(apr) || apr < 0 || apr > 99.99)) {
      setStatus("APR must be between 0 and 99.99.");
      return;
    }
    const response = await fetch("/api/accounts/apr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, apr }),
    });
    if (!response.ok) {
      setStatus("Could not save the APR.");
      return;
    }
    setAccounts((rows) =>
      rows.map((row) => (row.id === accountId ? { ...row, apr } : row)),
    );
    setStatus("Saved.");
  }

  return (
    <Panel title="Card APRs" eyebrow="Debt payoff accuracy">
      <p className="mb-4 text-sm text-muted">
        Enter each card&apos;s APR so the debt payoff planner uses real rates
        instead of assuming 22%.
      </p>
      <ul className="space-y-3 text-sm">
        {accounts.map((account) => (
          <li key={account.id} className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 truncate font-semibold">
              {account.name ?? "Card"}
              {account.mask ? ` ••${account.mask}` : ""}
            </span>
            <Input
              type="number"
              min="0"
              max="99.99"
              step="0.01"
              placeholder={account.apr !== null ? String(account.apr) : "e.g. 24.99"}
              value={drafts[account.id] ?? (account.apr !== null ? String(account.apr) : "")}
              onChange={(e) =>
                setDrafts((d) => ({ ...d, [account.id]: e.target.value }))
              }
              className="w-28"
            />
            <Button onClick={() => save(account.id)} variant="ghost" size="sm">
              Save
            </Button>
          </li>
        ))}
      </ul>
      {status && <p className="mt-2 text-sm text-muted">{status}</p>}
    </Panel>
  );
}
