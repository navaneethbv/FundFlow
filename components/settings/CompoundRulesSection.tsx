"use client";
import { useEffect, useState } from "react";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import RuleConditionEditor, {
  newCondition,
} from "@/components/settings/RuleConditionEditor";
import {
  legacyToConditions,
  validateConditions,
  type RuleCondition,
} from "@/lib/rule-conditions";
import type { StoredCompoundRule } from "@/lib/compound-rule-service";
import type { SmartRule } from "@/lib/rules-engine";
import { validateRuleActions, type RuleActions } from "@/lib/rule-actions";
import { localDateKey } from "@/lib/format-date";
import { addDays } from "@/lib/date-utils";
export default function CompoundRulesSection() {
  const [rules, setRules] = useState<StoredCompoundRule[]>([]);
  const [id, setId] = useState("");
  const [conditions, setConditions] = useState<RuleCondition>({
    op: "and",
    children: [newCondition()],
  });
  const [actions, setActions] = useState<RuleActions>({});
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [start, setStart] = useState(() => addDays(localDateKey(), -30));
  const [end, setEnd] = useState(() => localDateKey());
  const [previewed, setPreviewed] = useState(false);
  async function reload() {
    const response = await fetch("/api/rules/compound");
    if (!response.ok) throw new Error("Could not load rules.");
    setRules((await response.json()).rules);
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/rules/compound", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load rules.");
        setRules((await response.json()).rules);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setStatus(error.message);
      });
    return () => controller.abort();
  }, []);
  function selectRule(value: string) {
    setId(value);
    const rule = rules.find((row) => row.id === value);
    setConditions(
      rule?.conditions ??
        (rule
          ? legacyToConditions({
              id: rule.id,
              matchType: rule.match_type as SmartRule["matchType"],
              pattern: rule.pattern,
              amountCondition: rule.amount_condition,
            })
          : { op: "and", children: [newCondition()] }),
    );
    setActions(
      rule?.actions ?? {
        ...(rule?.category ? { category: rule.category } : {}),
        ...(rule?.display_name ? { displayName: rule.display_name } : {}),
        ...(rule?.tags?.length ? { tags: rule.tags } : {}),
      },
    );
    setEnabled(rule?.enabled ?? true);
  }
  async function request(action: "save" | "preview" | "apply") {
    setBusy(true);
    setStatus("");
    try {
      const payload =
        action === "save"
          ? { action, ...(id ? { id } : {}), conditions, actions, enabled }
          : { action, start, end };
      const response = await fetch("/api/rules/compound", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Rule request failed.");
      setStatus(
        action === "save"
          ? "Rule saved. Existing transactions change only when you apply it."
          : `${result.matched} matched among ${result.evaluated} transactions; ${result.changed} changed.`,
      );
      setPreviewed(action === "preview");
      if (action === "save") {
        setId(result.id);
        await reload();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  function textAction(key: "category" | "displayName", value: string) {
    setActions((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    setPreviewed(false);
  }
  return (
    <Panel title="Compound rules" eyebrow="First match wins">
      <p className="mb-4 text-sm text-muted">
        Rules keep their creation order. At most 3 group levels, 20 conditions
        and 100 rules. Amount comparisons use absolute values; account
        conditions use IDs. No bank facts are overwritten.
      </p>
      <label className="mb-4 block text-sm">
        Edit or convert a rule
        <Select value={id} onChange={(event) => selectRule(event.target.value)}>
          <option value="">New rule</option>
          {rules.map((rule) => (
            <option key={rule.id} value={rule.id}>
              {rule.actions?.category ?? rule.category ?? rule.pattern} (
              {rule.id.slice(0, 8)})
            </option>
          ))}
        </Select>
      </label>
      <RuleConditionEditor node={conditions} onChange={setConditions} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Set category
          <Input
            value={actions.category ?? ""}
            onChange={(event) => textAction("category", event.target.value)}
          />
        </label>
        <label className="text-sm">
          Set display name
          <Input
            value={actions.displayName ?? ""}
            onChange={(event) => textAction("displayName", event.target.value)}
          />
        </label>
        <label className="text-sm">
          Add tags (comma separated)
          <Input
            value={actions.tags?.join(", ") ?? ""}
            onChange={(event) =>
              setActions((current) => ({
                ...current,
                tags: event.target.value
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              }))
            }
          />
        </label>
      </div>
      <div className="my-4 flex flex-wrap gap-4">
        {(["exclude", "transfer", "notify"] as const).map((key) => (
          <label key={key} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={actions[key] === true}
              onChange={(event) =>
                setActions((current) => ({
                  ...current,
                  [key]: event.target.checked,
                }))
              }
            />
            {
              {
                exclude: "Exclude from totals",
                transfer: "Mark as transfer",
                notify: "Notify in app",
              }[key]
            }
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Enabled
        </label>
      </div>
      <Button
        disabled={
          busy ||
          !validateConditions(conditions) ||
          !validateRuleActions(actions)
        }
        onClick={() => request("save")}
      >
        Save rule
      </Button>
      <fieldset className="mt-6 space-y-3 border-t border-panel-border pt-4">
        <legend className="text-sm font-semibold">
          Apply saved rules to posted history
        </legend>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            From
            <Input
              type="date"
              value={start}
              onChange={(event) => {
                setStart(event.target.value);
                setPreviewed(false);
              }}
            />
          </label>
          <label className="text-sm">
            Through
            <Input
              type="date"
              value={end}
              onChange={(event) => {
                setEnd(event.target.value);
                setPreviewed(false);
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted">
          Up to 500 transactions per range. User category and flow overrides
          win. Review the match count before applying.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => request("preview")}
          >
            Preview saved rules
          </Button>
          <Button
            disabled={busy || !previewed}
            onClick={() => request("apply")}
          >
            Apply saved rules
          </Button>
        </div>
      </fieldset>
      <p role="status" className="mt-3 text-sm">
        {status}
      </p>
    </Panel>
  );
}
