"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
}: {
  initialAccounts: ManualAccount[];
}) {
  const supabase = createClient();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<ManualAccount["account_type"]>("asset");
  const [balance, setBalance] = useState("");
  const [error, setError] = useState<string | null>(null);

  const includedTotal = accounts
    .filter((account) => account.include_in_net_worth)
    .reduce((sum, account) => sum + Number(account.balance), 0);

  async function addAccount(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsedBalance = Number(balance);
    if (!name.trim() || !Number.isFinite(parsedBalance)) {
      setError("Enter an account name and numeric balance.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("manual_accounts")
      .insert({
        user_id: userData.user?.id,
        name: name.trim(),
        account_type: accountType,
        balance: parsedBalance,
        include_in_net_worth: true,
      })
      .select("id, name, account_type, balance, include_in_net_worth")
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setAccounts((current) => [...current, data as ManualAccount]);
    setName("");
    setBalance("");
  }

  async function removeAccount(id: string) {
    const previous = accounts;
    setAccounts((current) => current.filter((account) => account.id !== id));
    const { error: deleteError } = await supabase.from("manual_accounts").delete().eq("id", id);
    if (deleteError) {
      setAccounts(previous);
      setError(deleteError.message);
    }
  }

  return (
    <Panel title="Manual accounts" eyebrow="Net worth">
      <p className="mb-4 text-sm text-muted">
        Included manual balance: <span className="font-bold text-foreground">{formatCurrency(includedTotal)}</span>
      </p>

      <div className="mb-4 space-y-2 text-sm">
        {accounts.map((account) => (
          <div key={account.id} className="flex items-center justify-between gap-3 rounded-field bg-panel-2 p-3">
            <span>
              <span className="block font-semibold">{account.name}</span>
              <span className="block text-xs text-muted">{account.account_type}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="font-bold">{formatCurrency(Number(account.balance))}</span>
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
