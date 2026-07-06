"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

interface Budget {
  id: string;
  category: string;
  monthly_limit: number;
}

export default function BudgetsSection({
  initialBudgets,
}: {
  initialBudgets: Budget[];
}) {
  const supabase = createClient();
  const [budgets, setBudgets] = useState<Budget[]>(initialBudgets);
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = Number(limit);
    if (!category.trim() || !Number.isFinite(parsed) || parsed < 0) {
      setError("Enter a category and a non-negative limit.");
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("budgets")
      .insert({
        user_id: userData.user?.id,
        category: category.trim(),
        monthly_limit: parsed,
      })
      .select("id, category, monthly_limit")
      .single();
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setBudgets((b) => [...b, data as Budget]);
    setCategory("");
    setLimit("");
  }

  async function remove(id: string) {
    await supabase.from("budgets").delete().eq("id", id);
    setBudgets((b) => b.filter((x) => x.id !== id));
  }

  return (
    <Panel title="Budget limits" eyebrow="Monthly targets">

      {budgets.length > 0 && (
        <ul className="mb-4 space-y-3 text-sm">
          {budgets.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-4">
              <span className="min-w-0 flex-1">
                <span className="mb-1 flex justify-between gap-3 font-semibold">
                  <span>{b.category}</span>
                  <span>{formatCurrency(b.monthly_limit)}</span>
                </span>
                <span className="block h-2 rounded-full bg-panel-hover">
                  <span className="block h-2 w-3/4 rounded-full bg-accent" />
                </span>
              </span>
              <Button
                onClick={() => remove(b.id)}
                variant="ghost"
                size="sm"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Field label="Category">
          <Input
            placeholder="FOOD_AND_DRINK"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </Field>
        <Field label="Limit">
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="500"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-28"
          />
        </Field>
        <Button type="submit" size="md">
          Add
        </Button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
