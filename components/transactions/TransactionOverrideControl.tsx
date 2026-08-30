"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { TRANSFER_GROUPS } from "@/lib/finance-domain";

type CashFlowClassification = "expense" | "income";

export interface TransactionOverride {
  displayCategory: string | null;
  cashFlowClassification: CashFlowClassification | null;
}

interface Props {
  transactionId: string;
  /** Raw provider primary category (e.g. TRANSFER_OUT); shown as immutable fact. */
  providerCategory: string | null;
  initialOverride: TransactionOverride;
  categories: string[];
}

function isProviderTransfer(providerCategory: string | null): boolean {
  const key = providerCategory?.trim().toUpperCase() ?? "";
  return TRANSFER_GROUPS.has(key);
}

/**
 * Self-contained classification override for one transaction. Lives beside
 * notes/splits in the transaction editor. Saving posts to
 * /api/transactions/override; when the provider classifies the row as a
 * transfer or loan payment, switching it to Spending/Income requires the user
 * to tick an explicit confirmation box.
 */
export default function TransactionOverrideControl({
  transactionId,
  providerCategory,
  initialOverride,
  categories,
}: Readonly<Props>) {
  const router = useRouter();
  const [displayCategory, setDisplayCategory] = useState(
    initialOverride.displayCategory ?? "",
  );
  const [classification, setClassification] = useState<
    CashFlowClassification | ""
  >(initialOverride.cashFlowClassification ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasOverride, setHasOverride] = useState(
    Boolean(
      initialOverride.displayCategory ||
        initialOverride.cashFlowClassification,
    ),
  );
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(
    null,
  );

  const providerIsTransfer = isProviderTransfer(providerCategory);
  const reclassifyingTransfer = providerIsTransfer && classification !== "";

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/transactions/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: transactionId,
          display_category: displayCategory.trim() || null,
          cash_flow_classification: classification || null,
          confirmed: confirmed || undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? "Could not save the override.");
      setHasOverride(Boolean(displayCategory.trim() || classification));
      setMessage({ kind: "success", text: "Override saved." });
      setConfirmed(false);
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Could not save." });
    } finally {
      setSaving(false);
    }
  }

  async function clearOverride() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/transactions/override", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: transactionId }),
      });
      if (!res.ok) throw new Error("Could not clear the override.");
      setDisplayCategory("");
      setClassification("");
      setHasOverride(false);
      setMessage({ kind: "success", text: "Override cleared." });
      router.refresh();
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not clear.",
      });
    } finally {
      setSaving(false);
    }
  }

  const inputId = (suffix: string) => `override-${suffix}-${transactionId}`;

  return (
    <fieldset className="mt-4 rounded-field border border-panel-border bg-panel-2 p-3">
      <legend className="px-1 text-sm font-medium">Classification override</legend>
      {providerCategory && (
        <p className="mb-2 text-xs text-muted">
          Provider category: <span className="font-medium text-foreground">{providerCategory}</span>.
          {providerIsTransfer && (
            <span className="block text-warning">
              This row is currently excluded from cash flow as a transfer.
            </span>
          )}
        </p>
      )}

      <label className="mb-1 block text-xs font-medium" htmlFor={inputId("display")}>
        Display category
      </label>
      <input
        id={inputId("display")}
        list={`${inputId("cats")}`}
        value={displayCategory}
        onChange={(e) => {
          setDisplayCategory(e.target.value);
        }}
        placeholder="SHOPPING"
        className={cn(
          "w-full rounded-field border border-panel-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent/50",
        )}
      />
      <datalist id={`${inputId("cats")}`}>
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>

      <label className="mb-1 mt-3 block text-xs font-medium" htmlFor={inputId("flow")}>
        Cash-flow classification
      </label>
      <select
        id={inputId("flow")}
        value={classification}
        onChange={(e) => {
          setClassification(e.target.value as CashFlowClassification | "");
        }}
        className="w-full rounded-field border border-panel-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent/50"
      >
        <option value="">Follow provider</option>
        <option value="expense">Spending</option>
        <option value="income">Income</option>
      </select>

      {reclassifyingTransfer && (
        <label className="mt-3 flex items-start gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked);
            }}
            className="mt-0.5"
          />
          <span>
            I confirm this is real spending or income, not a transfer. It will be
            counted in cash-flow totals.
          </span>
        </label>
      )}

      {message && (
        <output
          className={cn(
            "mt-2 block text-xs",
            message.kind === "error" ? "text-danger" : "text-muted",
          )}
        >
          {message.text}
        </output>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        {hasOverride ? (
          <button
            type="button"
            className="text-xs text-muted hover:text-foreground"
            onClick={() => {
              void clearOverride();
            }}
            disabled={saving}
          >
            Clear override
          </button>
        ) : null}
        <Button type="button" size="sm" variant="secondary" onClick={save} loading={saving}>
          Save classification
        </Button>
      </div>
    </fieldset>
  );
}
