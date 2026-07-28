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
  rollover_enabled?: boolean;
  household_id?: string | null;
}

export interface BudgetSuggestionItem {
  category: string;
  suggestedLimit: number;
  median: number;
  months: number;
}

export default function BudgetsSection({
  initialBudgets,
  suggestions = [],
  householdId = null,
}: {
  initialBudgets: Budget[];
  suggestions?: BudgetSuggestionItem[];
  /** When set, budgets can be shared with this household (4.2-lite). */
  householdId?: string | null;
}) {
  const supabase = createClient();
  const [budgets, setBudgets] = useState<Budget[]>(initialBudgets);
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function insertBudget(categoryValue: string, limitValue: number) {
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("budgets")
      .insert({
        user_id: userData.user?.id,
        category: categoryValue,
        monthly_limit: limitValue,
      })
      .select("id, category, monthly_limit")
      .single();
    if (insertError) {
      setError(insertError.message);
      return false;
    }
    setBudgets((b) => [...b, data as Budget]);
    return true;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = Number(limit);
    if (!category.trim() || !Number.isFinite(parsed) || parsed < 0) {
      setError("Enter a category and a non-negative limit.");
      return;
    }
    if (await insertBudget(category.trim(), parsed)) {
      setCategory("");
      setLimit("");
    }
  }

  const budgetedCategories = new Set(
    budgets.map((b) => b.category.trim().toUpperCase()),
  );
  const openSuggestions = suggestions.filter(
    (s) => !budgetedCategories.has(s.category.trim().toUpperCase()),
  );

  async function remove(id: string) {
    await supabase.from("budgets").delete().eq("id", id);
    setBudgets((b) => b.filter((x) => x.id !== id));
  }

  async function toggleRollover(id: string, enabled: boolean) {
    setError(null);
    const { error: updateError } = await supabase
      .from("budgets")
      .update({ rollover_enabled: enabled })
      .eq("id", id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setBudgets((b) =>
      b.map((x) => (x.id === id ? { ...x, rollover_enabled: enabled } : x)),
    );
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
                <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={Boolean(b.rollover_enabled)}
                    onChange={(e) => toggleRollover(b.id, e.target.checked)}
                  />
                  Roll unused budget into next month
                </label>
                {householdId && (
                  <label className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={Boolean(b.household_id)}
                      onChange={async (e) => {
                        const nextValue = e.target.checked ? householdId : null;
                        const { error: shareError } = await supabase
                          .from("budgets")
                          .update({ household_id: nextValue })
                          .eq("id", b.id);
                        if (shareError) {
                          setError(shareError.message);
                          return;
                        }
                        setBudgets((rows) =>
                          rows.map((row) =>
                            row.id === b.id ? { ...row, household_id: nextValue } : row,
                          ),
                        );
                      }}
                    />
                    Visible to my household
                  </label>
                )}
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

      {openSuggestions.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">Suggested budgets</p>
          <p className="mb-3 text-xs text-muted">
            From your median monthly spend, plus 5% headroom.
          </p>
          <ul className="space-y-2 text-sm">
            {openSuggestions.map((suggestion) => (
              <li
                key={suggestion.category}
                className="flex items-center justify-between gap-3 rounded-field border border-panel-border bg-panel-2 p-3"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {suggestion.category}
                  </span>
                  <span className="block text-xs text-muted">
                    median {formatCurrency(suggestion.median)} over{" "}
                    {suggestion.months} months
                  </span>
                </span>
                <Button
                  onClick={() =>
                    insertBudget(suggestion.category, suggestion.suggestedLimit)
                  }
                  variant="ghost"
                  size="sm"
                >
                  Add {formatCurrency(suggestion.suggestedLimit)}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
