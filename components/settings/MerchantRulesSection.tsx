"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import { safeCompileRegex } from "@/lib/rules-engine";

export interface MerchantRule {
  id: string;
  match_type: "merchant" | "keyword" | "account" | "regex";
  pattern: string;
  display_name: string | null;
  category: string | null;
  tags?: string[];
  enabled: boolean;
}

interface BatchPreviewItem {
  transactionId: string;
  original: {
    merchant: string;
    category: string | null;
    tags: string[];
  };
  updated: {
    merchant: string;
    category: string | null;
    tags: string[];
  };
}

export default function MerchantRulesSection({
  initialRules,
}: Readonly<{
  initialRules: MerchantRule[];
}>) {
  const supabase = createClient();
  const [rules, setRules] = useState<MerchantRule[]>(initialRules);
  const [matchType, setMatchType] = useState<MerchantRule["match_type"]>("keyword");
  const [pattern, setPattern] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Batch simulation state
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    totalEvaluated: number;
    matchedCount: number;
    modifiedCount: number;
    preview: BatchPreviewItem[];
  } | null>(null);

  async function addRule(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!pattern.trim()) {
      setError("Pattern is required.");
      return;
    }

    if (matchType === "regex") {
      const compiled = safeCompileRegex(pattern);
      if (!compiled) {
        setError(
          "Invalid or unsafe regular expression syntax (nested quantifiers disallowed, max 120 chars).",
        );
        return;
      }
    }

    const parsedTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const { data: userData } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("merchant_rules")
      .insert({
        user_id: userData.user?.id,
        match_type: matchType,
        pattern: pattern.trim(),
        display_name: displayName.trim() || null,
        category: category.trim() || null,
        tags: parsedTags,
      })
      .select("id, match_type, pattern, display_name, category, tags, enabled")
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setRules((current) => [...current, data as MerchantRule]);
    setPattern("");
    setDisplayName("");
    setCategory("");
    setTags("");
    setSuccess("Rule added successfully.");
  }

  async function removeRule(id: string) {
    setError(null);
    setSuccess(null);

    const { error: deleteError } = await supabase
      .from("merchant_rules")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setRules((current) => current.filter((rule) => rule.id !== id));
    setSuccess("Rule removed.");
  }

  async function runBatchSimulation() {
    setSimulating(true);
    setError(null);
    try {
      const res = await fetch("/api/rules/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Simulation failed");
      setBatchResult(data);
      setBatchModalOpen(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error running simulation");
    } finally {
      setSimulating(false);
    }
  }

  async function applyBatchLive() {
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/rules/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Applying rules failed");
      setSuccess(`Rules applied successfully across ${data.appliedCount} transactions.`);
      setBatchModalOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error applying rules");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Panel title="Merchant cleanup & smart rules" eyebrow="Rules">
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
                {rule.tags && rule.tags.length > 0 ? ` • Tags: ${rule.tags.join(", ")}` : ""}
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => removeRule(rule.id)}>
              Remove
            </Button>
          </div>
        ))}
        {rules.length === 0 && <p className="text-sm text-muted">No cleanup rules yet.</p>}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-panel-border/60 pt-4">
        <p className="text-xs text-muted">
          Smart rules automatically clean up merchant names, map categories, and apply tags.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={runBatchSimulation}
          disabled={simulating || rules.length === 0}
        >
          {simulating ? "Simulating..." : "Run retroactively on history"}
        </Button>
      </div>

      <form onSubmit={addRule} className="grid gap-3 sm:grid-cols-2">
        <Field label="Match type" htmlFor="rule-match-type">
          <Select
            id="rule-match-type"
            value={matchType}
            onChange={(event) => {
              setMatchType(event.target.value as MerchantRule["match_type"]);
            }}
          >
            <option value="keyword">Keyword (contains)</option>
            <option value="merchant">Merchant contains</option>
            <option value="account">Account name</option>
            <option value="regex">Regex pattern (advanced)</option>
          </Select>
        </Field>
        <Field label="Pattern" htmlFor="rule-pattern">
          <Input
            id="rule-pattern"
            value={pattern}
            onChange={(event) => {
              setPattern(event.target.value);
            }}
            placeholder={matchType === "regex" ? "^(AMZN|Amazon).*Mktp" : "SQ *COFFEE"}
          />
        </Field>
        <Field label="Display name" htmlFor="rule-display-name">
          <Input
            id="rule-display-name"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            placeholder="Coffee Bar"
          />
        </Field>
        <Field label="Category" htmlFor="rule-category">
          <Input
            id="rule-category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
            }}
            placeholder="FOOD_AND_DRINK"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Tags (comma-separated)" htmlFor="rule-tags">
            <Input
              id="rule-tags"
              value={tags}
              onChange={(event) => {
                setTags(event.target.value);
              }}
              placeholder="groceries, essential"
            />
          </Field>
        </div>
        <Button type="submit" className="sm:col-span-2">
          Add rule
        </Button>
      </form>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {success && <p className="mt-3 text-sm text-success">{success}</p>}

      {/* Batch Preview & Apply Modal */}
      <Modal
        open={batchModalOpen}
        onClose={() => {
          setBatchModalOpen(false);
        }}
        titleId="rules-batch-title"
        ariaLabel="Retroactive rule simulation"
      >
        <div className="space-y-4 text-sm">
          <div className="border-b border-panel-border/50 pb-2">
            <h2 id="rules-batch-title" className="text-base font-bold text-foreground">
              Retroactive rule simulation
            </h2>
          </div>
          {batchResult && (
            <>
              <div className="grid grid-cols-3 gap-2 rounded-field bg-panel-2 p-3 text-center">
                <div>
                  <div className="text-lg font-bold">{batchResult.totalEvaluated}</div>
                  <div className="text-xs text-muted">Evaluated</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-accent">{batchResult.matchedCount}</div>
                  <div className="text-xs text-muted">Matched</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-success">{batchResult.modifiedCount}</div>
                  <div className="text-xs text-muted">Modified</div>
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                  Preview changes (up to 50)
                </h4>
                {batchResult.preview.length === 0 ? (
                  <p className="text-xs text-muted">
                    No transactions modified by current rules.
                  </p>
                ) : (
                  <div className="max-h-60 space-y-2 overflow-y-auto rounded-field border border-panel-border/60 p-2">
                    {batchResult.preview.map((p) => (
                      <div
                        key={p.transactionId}
                        className="flex flex-col gap-0.5 border-b border-panel-border/40 pb-1.5 last:border-b-0"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="line-through text-muted">{p.original.merchant}</span>
                          <span className="font-semibold text-accent">→ {p.updated.merchant}</span>
                        </div>
                        {p.original.category !== p.updated.category && (
                          <div className="text-[11px] text-muted">
                            Category: {p.original.category ?? "None"} → {p.updated.category}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setBatchModalOpen(false);
                  }}
                  disabled={applying}
                >
                  Close
                </Button>
                <Button
                  onClick={applyBatchLive}
                  disabled={applying || batchResult.modifiedCount === 0}
                >
                  {applying ? "Applying..." : "Apply to all matched"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </Panel>
  );
}
