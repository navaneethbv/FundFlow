"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";

interface MerchantRule {
  id: string;
  match_type: "merchant" | "keyword" | "account";
  pattern: string;
  display_name: string | null;
  category: string | null;
  enabled: boolean;
}

export default function MerchantRulesSection({
  initialRules,
}: {
  initialRules: MerchantRule[];
}) {
  const supabase = createClient();
  const [rules, setRules] = useState(initialRules);
  const [matchType, setMatchType] = useState<MerchantRule["match_type"]>("keyword");
  const [pattern, setPattern] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function addRule(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!pattern.trim()) {
      setError("Enter a merchant, keyword, or account pattern.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("merchant_rules")
      .insert({
        user_id: userData.user?.id,
        match_type: matchType,
        pattern: pattern.trim(),
        display_name: displayName.trim() || null,
        category: category.trim() || null,
      })
      .select("id, match_type, pattern, display_name, category, enabled")
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setRules((current) => [...current, data as MerchantRule]);
    setPattern("");
    setDisplayName("");
    setCategory("");
  }

  async function removeRule(id: string) {
    const previous = rules;
    setRules((current) => current.filter((rule) => rule.id !== id));
    const { error: deleteError } = await supabase.from("merchant_rules").delete().eq("id", id);
    if (deleteError) {
      setRules(previous);
      setError(deleteError.message);
    }
  }

  return (
    <Panel title="Merchant cleanup" eyebrow="Rules">
      <div className="mb-4 space-y-3 text-sm">
        {rules.map((rule) => (
          <div key={rule.id} className="flex items-center justify-between gap-3 rounded-field bg-panel-2 p-3">
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 font-semibold">
                {rule.pattern}
                <Badge tone={rule.enabled ? "success" : "neutral"}>{rule.match_type}</Badge>
              </span>
              <span className="block text-xs text-muted">
                {rule.display_name || "Keep merchant"} - {rule.category || "Keep category"}
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => removeRule(rule.id)}>
              Remove
            </Button>
          </div>
        ))}
        {rules.length === 0 && <p className="text-sm text-muted">No cleanup rules yet.</p>}
      </div>

      <form onSubmit={addRule} className="grid gap-3 sm:grid-cols-2">
        <Field label="Match">
          <Select value={matchType} onChange={(event) => setMatchType(event.target.value as MerchantRule["match_type"])}>
            <option value="keyword">Keyword</option>
            <option value="merchant">Exact merchant</option>
            <option value="account">Account</option>
          </Select>
        </Field>
        <Field label="Pattern">
          <Input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="SQ *COFFEE" />
        </Field>
        <Field label="Display name">
          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Coffee Bar" />
        </Field>
        <Field label="Category">
          <Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="FOOD_AND_DRINK" />
        </Field>
        <Button type="submit" className="sm:col-span-2">
          Add rule
        </Button>
      </form>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
