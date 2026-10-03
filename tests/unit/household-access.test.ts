import { describe, expect, it, vi } from "vitest";

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({ logError: (...args: unknown[]) => mockLogError(...args) }));

import { isReportsOnlyMember } from "@/lib/household-access";

function serviceWith(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  return { from: vi.fn(() => query) } as never;
}

describe("isReportsOnlyMember", () => {
  it("returns true for an active reports-only membership", async () => {
    expect(await isReportsOnlyMember(serviceWith({ data: { id: "m1" }, error: null }), "u1")).toBe(true);
  });

  it("returns false when no reports-only membership exists", async () => {
    expect(await isReportsOnlyMember(serviceWith({ data: null, error: null }), "u1")).toBe(false);
  });

  it("fails closed and logs when the membership lookup errors", async () => {
    expect(await isReportsOnlyMember(serviceWith({ data: null, error: { message: "db down" } }), "u1")).toBe(true);
    expect(mockLogError).toHaveBeenCalledWith("household.reports-only-lookup", expect.anything());
  });
});
