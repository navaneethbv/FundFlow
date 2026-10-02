"use client";
import { useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import type { RuleCondition } from "@/lib/rule-conditions";
import { localDateKey } from "@/lib/format-date";
import { addDays } from "@/lib/date-utils";
interface Choice {
  label: string;
  condition: RuleCondition;
}
export default function RuleSuggestion({
  transactionId,
  category,
  onClose,
}: Readonly<{ transactionId: string; category: string; onClose: () => void }>) {
  const [choices, setChoices] = useState<Choice[]>([]);
  const [selected, setSelected] = useState<number[]>([0]);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [past, setPast] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [end] = useState(() => localDateKey());
  const start = addDays(end, -30);
  const conditions = useMemo<RuleCondition>(
    () => ({
      op: "and",
      children: choices
        .filter((_, index) => selected.includes(index))
        .map((choice) => choice.condition),
    }),
    [choices, selected],
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/rules/suggestion?id=${encodeURIComponent(transactionId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Could not load suggested conditions.");
        const data = await response.json();
        const next: Choice[] = [];
        if (data.merchant)
          next.push({
            label: `Merchant equals ${data.merchant}`,
            condition: {
              field: "merchant",
              operator: "equals",
              value: data.merchant,
            },
          });
        if (data.name)
          next.push({
            label: `Name equals ${data.name}`,
            condition: { field: "name", operator: "equals", value: data.name },
          });
        next.push({
          label: `Absolute amount equals ${data.amount}`,
          condition: {
            field: "amount",
            operator: "between",
            value: data.amount,
            maxValue: data.amount,
          },
        });
        if (data.accountId)
          next.push({
            label: "Same account",
            condition: {
              field: "account",
              operator: "equals",
              value: data.accountId,
            },
          });
        setChoices(next);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [transactionId]);
  useEffect(() => {
    if (!choices.length || !selected.length) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setCount(null);
      fetch("/api/rules/compound", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ action: "preview", start, end, conditions }),
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.error ?? "Could not count matches.");
          setCount(data.matched);
          setError("");
        })
        .catch((failure) => {
          if (!controller.signal.aborted) setError(failure.message);
        });
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [conditions, choices.length, selected.length, start, end]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      let ruleId = savedId;
      if (!ruleId) {
        const response = await fetch("/api/rules/compound", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "save",
            conditions,
            actions: { category },
          }),
        });
        if (!response.ok) throw new Error("Could not save the rule.");
        ruleId = (await response.json()).id;
        setSavedId(ruleId);
      }
      if (past) {
        const response = await fetch("/api/rules/compound", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "apply", ruleId, start, end }),
        });
        if (!response.ok)
          throw new Error(
            "Rule saved, but past application failed. Retry or inspect Rules.",
          );
      }
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not save rule.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="mt-4 space-y-3 rounded-field border border-panel-border p-3"
      aria-label="Suggested categorization rule"
    >
      <h3 className="font-semibold">Use this category next time?</h3>
      <p className="text-sm text-muted">
        Set {category} when all selected conditions match. Earlier rules and
        manual overrides retain priority.
      </p>
      {choices.map((choice, index) => (
        <label
          key={choice.label}
          className="flex min-h-11 items-center gap-2 text-sm"
        >
          <input
            type="checkbox"
            disabled={busy || !!savedId}
            checked={selected.includes(index)}
            onChange={(event) => {
              setCount(null);
              setSelected((current) =>
                event.target.checked
                  ? [...current, index]
                  : current.filter((item) => item !== index),
              );
            }}
          />
          {choice.label}
        </label>
      ))}
      <p role="status" className="text-sm">
        {selected.length
          ? `${count ?? "Counting"} matches in the last 30 days (up to 500 transactions).`
          : "Select at least one condition."}
      </p>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={past}
          onChange={(event) => setPast(event.target.checked)}
        />
        Also apply this rule to the last 30 days
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || !selected.length || count === null}
          onClick={save}
        >
          Save suggested rule
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}
