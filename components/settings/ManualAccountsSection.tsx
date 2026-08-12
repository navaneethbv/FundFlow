"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";

interface ManualAccount {
  id: string;
  name: string;
  account_type: "asset" | "liability" | "cash" | "investment" | "debt";
  balance: number;
  include_in_net_worth: boolean;
}

export default function ManualAccountsSection({
  initialAccounts,
}: Readonly<{
  initialAccounts: ManualAccount[];
}>) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [balanceDrafts, setBalanceDrafts] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        initialAccounts.map((account) => [
          account.id,
          String(Number(account.balance)),
        ]),
      ),
  );
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<ManualAccount["account_type"]>("asset");
  const [balance, setBalance] = useState("");
  const [error, setError] = useState<string | null>(null);

  const includedTotal = accounts
    .filter((account) => account.include_in_net_worth)
    .reduce((sum, account) => sum + Number(account.balance), 0);

  async function addAccount(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const parsedBalance = Number(balance);
    if (!name.trim() || !Number.isFinite(parsedBalance)) {
      setError("Enter an account name and numeric balance.");
      return;
    }

    const response = await fetch("/api/manual-accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        accountType,
        balance: parsedBalance,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      account?: ManualAccount;
      error?: string;
    };
    if (!response.ok || !payload.account) {
      setError(payload.error ?? "Could not add the account.");
      return;
    }

    const account = payload.account;
    setAccounts((current) => [...current, account]);
    setBalanceDrafts((current) => ({
      ...current,
      [account.id]: String(Number(account.balance)),
    }));
    setName("");
    setBalance("");
  }

  async function toggleInclusion(account: ManualAccount) {
    setError(null);
    const next = !account.include_in_net_worth;
    const response = await fetch("/api/manual-accounts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: account.id,
        balance: account.balance,
        includeInNetWorth: next,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      account?: ManualAccount;
      error?: string;
    };
    if (!response.ok || !payload.account) {
      setError(payload.error ?? "Could not update the account.");
      return;
    }
    setAccounts((current) =>
      current.map((item) =>
        item.id === account.id ? payload.account! : item,
      ),
    );
  }

  async function saveAccount(account: ManualAccount) {
    setError(null);
    const parsedBalance = Number(balanceDrafts[account.id]);
    if (!Number.isFinite(parsedBalance)) {
      setError(`Enter a numeric balance for ${account.name}.`);
      return;
    }

    const response = await fetch("/api/manual-accounts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: account.id,
        balance: parsedBalance,
        includeInNetWorth: account.include_in_net_worth,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      account?: ManualAccount;
      error?: string;
    };
    if (!response.ok || !payload.account) {
      setError(payload.error ?? "Could not update the account.");
      return;
    }
    setAccounts((current) =>
      current.map((item) =>
        item.id === account.id ? payload.account! : item,
      ),
    );
  }

  async function removeAccount(id: string) {
    const previous = accounts;
    setAccounts((current) => current.filter((account) => account.id !== id));
    const response = await fetch("/api/manual-accounts", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setAccounts(previous);
      setError(payload.error ?? "Could not remove the account.");
      return;
    }
    setBalanceDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  return (
    <Panel title="Manual accounts" eyebrow="Net worth">
      <p className="mb-4 text-sm text-muted">
        Included manual balance: <span className="money font-bold text-foreground">{formatCurrency(includedTotal)}</span>
      </p>

      <div className="mb-4 space-y-2 text-sm">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="grid gap-3 rounded-field bg-panel-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)_auto]"
          >
            <span className="self-center">
              <span className="block font-semibold">{account.name}</span>
              <span className="block text-xs text-muted">{account.account_type}</span>
            </span>
            <span className="space-y-2">
              <Input
                type="number"
                step="0.01"
                aria-label={`Balance for ${account.name}`}
                value={balanceDrafts[account.id] ?? ""}
                onChange={(event) =>
                  setBalanceDrafts((current) => ({
                    ...current,
                    [account.id]: event.target.value,
                  }))
                }
              />
              <label className="flex min-h-11 items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={account.include_in_net_worth}
                  onChange={() => toggleInclusion(account)}
                />
                Include in net worth
              </label>
            </span>
            <span className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => saveAccount(account)}
              >
                Save balance
              </Button>
              <Button variant="ghost" size="sm" onClick={() => removeAccount(account.id)}>
                Remove
              </Button>
            </span>
          </div>
        ))}
        {accounts.length === 0 && <p className="text-sm text-muted">No manual accounts yet.</p>}
      </div>

      <form onSubmit={addAccount} className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Brokerage" />
        </Field>
        <Field label="Type">
          <Select value={accountType} onChange={(event) => setAccountType(event.target.value as ManualAccount["account_type"])}>
            <option value="asset">Asset</option>
            <option value="cash">Cash</option>
            <option value="investment">Investment</option>
            <option value="liability">Liability</option>
            <option value="debt">Debt</option>
          </Select>
        </Field>
        <Field label="Balance">
          <Input type="number" step="0.01" value={balance} onChange={(event) => setBalance(event.target.value)} placeholder="10000" />
        </Field>
        <Button type="submit">Add account</Button>
      </form>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
