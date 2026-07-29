import { describe, it, expect } from "vitest";
import { buildAdviceView } from "@/lib/advice";

describe("lib/advice.ts", () => {
  it("computes advice task completion status", () => {
    const view = buildAdviceView(undefined, [
      { advice_id: "emergency-fund", task_id: "task-ef-1" },
    ]);

    expect(view.prioritized.length).toBeGreaterThan(0);
    const ef = view.prioritized.find((i) => i.id === "emergency-fund");
    expect(ef?.done).toBe(1);
    expect(ef?.started).toBe(true);
  });
});
