import { describe, expect, it } from "vitest";
import {
  defaultDecisionsForPlan,
  goalDecisionOptions,
} from "@/components/settings/MonarchConfigImportSection";

describe("MonarchConfigImportSection goal decisions", () => {
  const matched = {
    decisionKey: "goal:0",
    matchedGoalId: "g-1",
    defaultDecision: "merge" as const,
    allowedDecisions: ["merge", "replace", "skip"] as const,
  };
  const unmatched = {
    decisionKey: "goal:1",
    matchedGoalId: null,
    defaultDecision: "create" as const,
    allowedDecisions: ["create", "skip"] as const,
  };

  it("uses plan identities and server-selected defaults", () => {
    expect(defaultDecisionsForPlan({
      kind: "goal",
      plan: { rows: [matched, unmatched] },
    } as never)).toEqual({
      "goal:0": "merge",
      "goal:1": "create",
    });
  });

  it("shows only decisions allowed by the matched state", () => {
    expect(goalDecisionOptions(matched as never).map((option) => option.value)).toEqual([
      "merge",
      "replace",
      "skip",
    ]);
    expect(goalDecisionOptions(unmatched as never).map((option) => option.value)).toEqual([
      "create",
      "skip",
    ]);
  });
});
