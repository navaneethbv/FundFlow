import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldSubmitAmountCorrection } from "@/components/recurring/RecurringList";

/**
 * `RecurringList` is a "use client" component and this repo has no
 * jsdom/@testing-library setup (vitest here runs under `environment: "node"`
 * and only pure `.ts` files, never `.tsx`) — every other client-component
 * test in this codebase (see tests/unit/goals-ui.test.ts,
 * tests/unit/transactions-ui.test.ts, tests/unit/sidebar-nav.test.ts, etc.)
 * follows the same two-part convention: unit-test any pure logic directly,
 * and assert on the component's source for structural/behavioral guarantees
 * that would otherwise require rendering. This file follows that convention.
 */
const source = readFileSync("components/recurring/RecurringList.tsx", "utf8");

describe("shouldSubmitAmountCorrection", () => {
  it("does not submit an untouched field (equal to its seeded initial value)", () => {
    expect(shouldSubmitAmountCorrection("15.49", "15.49")).toBe(false);
  });

  it("does not submit an empty field", () => {
    expect(shouldSubmitAmountCorrection("", "")).toBe(false);
    expect(shouldSubmitAmountCorrection("   ", "")).toBe(false);
  });

  it("submits when the user actually typed a different value", () => {
    expect(shouldSubmitAmountCorrection("20", "15.49")).toBe(true);
    expect(shouldSubmitAmountCorrection("20", "")).toBe(true);
  });
});

describe("RecurringList ownership gating (Fix 1)", () => {
  it("only renders the amount input and action buttons for the caller's own streams", () => {
    expect(source).toContain("stream.isOwn");
    expect(source).toMatch(/stream\.isOwn\s*\?/);
  });

  it("shows a read-only note instead of interactive controls for shared, non-owned streams", () => {
    expect(source).toContain("Shared · view only");
  });
});

describe("RecurringList amount field seeding (Fix 2)", () => {
  it("seeds the input from userAmount only, never falling back to averageAmount", () => {
    expect(source).toContain('stream.userAmount != null ? String(stream.userAmount) : ""');
    expect(source).not.toContain("String(stream.userAmount ?? stream.averageAmount ?? 0)");
  });

  it("uses averageAmount only as a placeholder hint, not a seeded value", () => {
    expect(source).toContain("placeholder={stream.averageAmount != null ? String(stream.averageAmount) : undefined}");
  });

  it("guards onBlur with shouldSubmitAmountCorrection instead of firing unconditionally", () => {
    expect(source).toContain("shouldSubmitAmountCorrection(amount, initialAmount)");
  });
});
