import { describe, it, expect } from "vitest";
import {
  buildAdviceView,
  validateAdviceLibrary,
  validateAdvicePriorities,
  validateAdviceProfile,
  type AdviceItem,
  type AdviceContext,
} from "@/lib/advice";

const CTX_NEUTRAL: AdviceContext = {
  runwayMonths: 6,
  hasBudget: true,
  hasGoals: true,
  creditCardCarry: false,
  hasInvestments: true,
};

function item(partial: Partial<AdviceItem> = {}): AdviceItem {
  return {
    id: "a",
    version: 1,
    category: "save_up",
    title: "T",
    body: "B",
    tasks: [{ id: "t1", label: "Task 1" }, { id: "t2", label: "Task 2" }],
    sources: [{ title: "S", url: "https://www.consumerfinance.gov", reviewedAt: "2026-01-01" }],
    ...partial,
  };
}

describe("buildAdviceView", () => {
  it("puts an always-relevant item in Essential when there is no saved priority", () => {
    const library = [item({ id: "essential-1" })];
    const view = buildAdviceView(library, [], null, CTX_NEUTRAL);
    expect(view.essential.map((i) => i.id)).toEqual(["essential-1"]);
    expect(view.prioritized).toEqual([]);
  });

  it("defaults Prioritized to unfinished relevant items when nothing is saved", () => {
    const library = [
      item({ id: "relevant", relevantWhen: () => true }),
      item({ id: "not-relevant", relevantWhen: () => false }),
    ];
    const view = buildAdviceView(library, [], null, CTX_NEUTRAL);
    expect(view.prioritized.map((i) => i.id)).toEqual(["relevant"]);
  });

  it("evaluates relevantWhen against the given context", () => {
    const library = [item({ id: "low-runway", relevantWhen: (ctx) => (ctx.runwayMonths ?? 99) < 3 })];
    const shown = buildAdviceView(library, [], null, { ...CTX_NEUTRAL, runwayMonths: 1 });
    const hidden = buildAdviceView(library, [], null, { ...CTX_NEUTRAL, runwayMonths: 6 });
    expect(shown.prioritized.map((i) => i.id)).toEqual(["low-runway"]);
    expect(hidden.prioritized).toEqual([]);
  });

  it("honors a user's saved priority order even over relevantWhen", () => {
    const library = [
      item({ id: "b", relevantWhen: () => false }),
      item({ id: "a", relevantWhen: () => true }),
    ];
    const view = buildAdviceView(library, [], ["a", "b"], CTX_NEUTRAL);
    expect(view.prioritized.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("drops an unknown id from a saved priority list instead of erroring", () => {
    const library = [item({ id: "a" })];
    const view = buildAdviceView(library, [], ["a", "ghost"], CTX_NEUTRAL);
    expect(view.prioritized.map((i) => i.id)).toEqual(["a"]);
  });

  it("counts done/total from progress rows scoped to the item's own tasks", () => {
    const library = [item({ id: "a" })];
    const view = buildAdviceView(
      library,
      [{ advice_id: "a", task_id: "t1" }, { advice_id: "other", task_id: "t1" }],
      ["a"],
      CTX_NEUTRAL,
    );
    expect(view.prioritized[0]).toMatchObject({ done: 1, total: 2, started: true });
  });

  it("does not double-count a duplicate progress row for the same task", () => {
    const library = [item({ id: "a" })];
    const view = buildAdviceView(
      library,
      [{ advice_id: "a", task_id: "t1" }, { advice_id: "a", task_id: "t1" }],
      ["a"],
      CTX_NEUTRAL,
    );
    expect(view.prioritized[0].done).toBe(1);
  });

  it("ignores progress for a task that content no longer has (a removed task)", () => {
    const library = [item({ id: "a", tasks: [{ id: "t1", label: "Task 1" }] })];
    const view = buildAdviceView(
      library,
      [{ advice_id: "a", task_id: "t1" }, { advice_id: "a", task_id: "removed-task" }],
      ["a"],
      CTX_NEUTRAL,
    );
    expect(view.prioritized[0]).toMatchObject({ done: 1, total: 1 });
  });

  it("rolls up completedCount across the whole library, not just what's shown", () => {
    const library = [
      item({ id: "done-item", relevantWhen: () => false }),
      item({ id: "not-done", relevantWhen: () => true }),
    ];
    const view = buildAdviceView(
      library,
      [{ advice_id: "done-item", task_id: "t1" }, { advice_id: "done-item", task_id: "t2" }],
      null,
      CTX_NEUTRAL,
    );
    expect(view.completedCount).toBe(1);
  });

  it("returns an empty view with no items and no progress", () => {
    const view = buildAdviceView([], [], null, CTX_NEUTRAL);
    expect(view).toEqual({ prioritized: [], essential: [], completedCount: 0 });
  });

  it("keeps a saved-priority item out of Essential to avoid showing it twice", () => {
    const library = [item({ id: "a" })]; // no relevantWhen -> would default to Essential
    const view = buildAdviceView(library, [], ["a"], CTX_NEUTRAL);
    expect(view.prioritized.map((i) => i.id)).toEqual(["a"]);
    expect(view.essential).toEqual([]);
  });

  it("carries sources through unchanged for rendering", () => {
    const library = [item({ id: "a" })];
    const view = buildAdviceView(library, [], ["a"], CTX_NEUTRAL);
    expect(view.prioritized[0].sources).toEqual([
      { title: "S", url: "https://www.consumerfinance.gov", reviewedAt: "2026-01-01" },
    ]);
  });
});

describe("validateAdviceLibrary", () => {
  const OPTS = { asOf: "2026-07-30", maxReviewAgeDays: 365 };

  it("passes a well-formed item", () => {
    expect(validateAdviceLibrary([item()], OPTS)).toEqual([]);
  });

  it("flags an item with no sources", () => {
    const violations = validateAdviceLibrary([item({ sources: [] })], OPTS);
    expect(violations).toContainEqual({ itemId: "a", reason: "missing sources" });
  });

  it("flags a stale source beyond the review interval", () => {
    const violations = validateAdviceLibrary(
      [item({ sources: [{ title: "S", url: "https://www.consumerfinance.gov", reviewedAt: "2024-01-01" }] })],
      OPTS,
    );
    expect(violations.some((v) => v.reason.startsWith("stale source review"))).toBe(true);
  });

  it("flags a duplicate task id within one item", () => {
    const violations = validateAdviceLibrary(
      [item({ tasks: [{ id: "t1", label: "A" }, { id: "t1", label: "B" }] })],
      OPTS,
    );
    expect(violations.some((v) => v.reason.includes("duplicate task id"))).toBe(true);
  });

  it("flags a source URL outside the allowed neutral hosts", () => {
    const violations = validateAdviceLibrary(
      [item({ sources: [{ title: "S", url: "https://some-broker.example.com", reviewedAt: "2026-01-01" }] })],
      OPTS,
    );
    expect(violations.some((v) => v.reason.includes("unsupported external source"))).toBe(true);
  });

  it("flags prohibited guarantee language in the title or body", () => {
    const violations = validateAdviceLibrary([item({ title: "This investment is guaranteed to double" })], OPTS);
    expect(violations.some((v) => v.reason.includes("guarantee"))).toBe(true);
  });

  it("flags a malformed source URL instead of throwing", () => {
    const violations = validateAdviceLibrary(
      [item({ sources: [{ title: "S", url: "not-a-url", reviewedAt: "2026-01-01" }] })],
      OPTS,
    );
    expect(violations.some((v) => v.reason.includes("unparseable"))).toBe(true);
  });
});

describe("validateAdvicePriorities", () => {
  const library = [item({ id: "a" }), item({ id: "b" })];

  it("accepts a list of known ids, deduplicated", () => {
    const result = validateAdvicePriorities(["a", "b", "a"], library);
    expect(result).toEqual({ ok: true, value: ["a", "b"] });
  });

  it("rejects a non-array input", () => {
    expect(validateAdvicePriorities("a", library).ok).toBe(false);
  });

  it("rejects an unknown advice id", () => {
    expect(validateAdvicePriorities(["a", "ghost"], library).ok).toBe(false);
  });

  it("accepts an empty array (clearing priorities)", () => {
    expect(validateAdvicePriorities([], library)).toEqual({ ok: true, value: [] });
  });
});

describe("validateAdviceProfile", () => {
  it("accepts null as clearing saved answers", () => {
    expect(validateAdviceProfile(null)).toEqual({ ok: true, value: null });
  });

  it("accepts a fully valid partial profile", () => {
    const result = validateAdviceProfile({ hasDependents: true });
    expect(result).toEqual({ ok: true, value: { hasDependents: true } });
  });

  it("accepts every field explicitly skipped (empty object)", () => {
    expect(validateAdviceProfile({})).toEqual({ ok: true, value: {} });
  });

  it("rejects an unknown field", () => {
    expect(validateAdviceProfile({ ssn: "123-45-6789" }).ok).toBe(false);
  });

  it("rejects a non-boolean hasDependents", () => {
    expect(validateAdviceProfile({ hasDependents: "yes" }).ok).toBe(false);
  });

  it("rejects an unrecognized employmentStatus", () => {
    expect(validateAdviceProfile({ employmentStatus: "billionaire" }).ok).toBe(false);
  });

  it("rejects an unrecognized homeownership value", () => {
    expect(validateAdviceProfile({ homeownership: "landlord" }).ok).toBe(false);
  });

  it("rejects an array", () => {
    expect(validateAdviceProfile([]).ok).toBe(false);
  });
});
