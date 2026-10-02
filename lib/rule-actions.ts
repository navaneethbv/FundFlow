import { isFeatureEnabled } from "@/lib/feature-flags";
export interface RuleActions {
  displayName?: string;
  category?: string;
  tags?: string[];
  exclude?: boolean;
  transfer?: boolean;
  notify?: boolean;
}
export function validateRuleActions(value: unknown): value is RuleActions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actions = value as Record<string, unknown>;
  const entries = Object.entries(actions);
  return (
    entries.length > 0 &&
    entries.every(([key, entry]) => {
      if (key === "displayName" || key === "category")
        return (
          typeof entry === "string" &&
          entry.trim().length > 0 &&
          entry.length <= 120
        );
      if (key === "tags")
        return (
          Array.isArray(entry) &&
          entry.length <= 20 &&
          entry.every(
            (tag) =>
              typeof tag === "string" &&
              tag.trim().length > 0 &&
              tag.length <= 50,
          )
        );
      return (
        ["exclude", "transfer", "notify"].includes(key) &&
        typeof entry === "boolean"
      );
    })
  );
}
export function annotationProjectionColumns<T extends string>(base: T): T {
  return (
    isFeatureEnabled("compoundRules") ? `${base}, rule_actions` : base
  ) as T;
}
export function storedRuleActions(value: unknown): RuleActions | undefined {
  const row = value as { rule_actions?: unknown };
  return validateRuleActions(row.rule_actions) ? row.rule_actions : undefined;
}

/** Effective tags preserve user-authored annotations and deduplicate rule additions. */
export function tagsWithRuleActions(
  tags: string[],
  actions?: RuleActions,
): string[] {
  return [...new Set([...tags, ...(actions?.tags ?? [])])];
}
