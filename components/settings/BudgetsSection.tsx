"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";

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
    <section className="rounded-lg border border-black/10 dark:border-white/15 p-4 space-y-3">
      <h2 className="font-semibold">Monthly budgets</h2>

      {budgets.length > 0 && (
        <ul className="text-sm space-y-1">
          {budgets.map((b) => (
            <li key={b.id} className="flex justify-between items-center">
              <span>
                {b.category} · {formatCurrency(b.monthly_limit)}
              </span>
              <button
                onClick={() => remove(b.id)}
                className="text-red-600 underline text-xs"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input
          placeholder="Category (e.g. FOOD_AND_DRINK)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-black/15 dark:border-white/25 bg-transparent px-3 py-1.5 text-sm"
        />
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="Limit"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="rounded border border-black/15 dark:border-white/25 bg-transparent px-3 py-1.5 text-sm w-28"
        />
        <button
          type="submit"
          className="rounded bg-foreground text-background px-3 py-1.5 text-sm"
        >
          Add
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
