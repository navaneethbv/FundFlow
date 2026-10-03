"use client";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import type { RuleCondition, TextField } from "@/lib/rule-conditions";
import type { AmountOperator } from "@/lib/rules-engine";
export const newCondition = (): RuleCondition => ({
  field: "merchant",
  operator: "contains",
  value: "",
});
export default function RuleConditionEditor({
  node,
  onChange,
  depth = 1,
  label = "Condition",
}: Readonly<{
  node: RuleCondition;
  onChange: (node: RuleCondition) => void;
  depth?: number;
  label?: string;
}>) {
  if ("op" in node)
    return (
      <fieldset className="min-w-0 space-y-3 rounded-field border border-panel-border p-3">
        <legend className="px-1 text-sm font-semibold">{label}</legend>
        <label className="block text-sm">
          Match
          <Select
            aria-label={`${label} combination`}
            value={node.op}
            onChange={(event) =>
              onChange({ ...node, op: event.target.value as "and" | "or" })
            }
          >
            <option value="and">All conditions (AND)</option>
            <option value="or">Any condition (OR)</option>
          </Select>
        </label>
        {node.children.map((child, index) => (
          <div key={`${label}-${index}`} className="space-y-1">
            <RuleConditionEditor
              node={child}
              depth={depth + 1}
              label={`${label} ${index + 1}`}
              onChange={(updated) =>
                onChange({
                  ...node,
                  children: node.children.map((entry, i) =>
                    i === index ? updated : entry,
                  ),
                })
              }
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${label} ${index + 1}`}
              onClick={() =>
                onChange({
                  ...node,
                  children: node.children.filter((_, i) => i !== index),
                })
              }
            >
              Remove
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onChange({
                ...node,
                children: [...node.children, newCondition()],
              })
            }
          >
            Add condition
          </Button>
          {depth < 3 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                onChange({
                  ...node,
                  children: [
                    ...node.children,
                    { op: "or", children: [newCondition()] },
                  ],
                })
              }
            >
              Add group
            </Button>
          )}
        </div>
      </fieldset>
    );
  if (node.field === "legacy")
    return (
      <p className="text-sm">
        {label}: legacy {node.matchType} match “{node.pattern}”. Its original
        matching behavior is preserved.
      </p>
    );
  const isAmount = node.field === "amount";
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
      <Select
        aria-label={`${label} field`}
        value={node.field}
        onChange={(event) =>
          onChange(
            event.target.value === "amount"
              ? { field: "amount", operator: "gte", value: 0 }
              : {
                  field: event.target.value as TextField,
                  operator: "contains",
                  value: "",
                },
          )
        }
      >
        {[
          "merchant",
          "name",
          "descriptor",
          "account",
          "amount",
          "category",
          "tag",
          "notes",
          "type",
        ].map((field) => (
          <option key={field} value={field}>
            {field === "account" ? "Account ID" : field}
          </option>
        ))}
      </Select>
      <Select
        aria-label={`${label} comparison`}
        value={node.operator}
        onChange={(event) =>
          onChange(
            isAmount
              ? { ...node, operator: event.target.value as AmountOperator }
              : {
                  ...node,
                  operator: event.target.value as
                    "contains" | "equals" | "regex",
                },
          )
        }
      >
        {(isAmount
          ? ["gt", "gte", "lt", "lte", "between", "any"]
          : ["contains", "equals", "regex"]
        ).map((operator) => (
          <option key={operator} value={operator}>
            {operator}
          </option>
        ))}
      </Select>
      <Input
        aria-label={`${label} value`}
        type={isAmount ? "number" : "text"}
        value={node.value ?? ""}
        onChange={(event) =>
          onChange(
            isAmount
              ? { ...node, value: Number(event.target.value) }
              : { ...node, value: event.target.value },
          )
        }
      />
      {isAmount && node.operator === "between" && (
        <Input
          aria-label={`${label} upper amount`}
          type="number"
          value={node.maxValue ?? ""}
          onChange={(event) =>
            onChange({ ...node, maxValue: Number(event.target.value) })
          }
        />
      )}
    </div>
  );
}
