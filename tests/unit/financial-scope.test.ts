import { describe, it, expect } from "vitest";
import {
  parseFinancialScope,
  scopeQueryUserId,
  serializeFinancialScope,
  type FinancialScope,
} from "@/lib/financial-scope";

const OWNER = "user-1";
const HOUSEHOLD = "hh-abc";

function parse(raw: string | string[] | undefined, visible: string[] = [HOUSEHOLD]): FinancialScope {
  return parseFinancialScope({ raw, ownerUserId: OWNER, visibleHouseholdIds: visible });
}

describe("parseFinancialScope", () => {
  it("defaults to the caller's own rows", () => {
    expect(parse(undefined)).toEqual({ kind: "mine", ownerUserId: OWNER });
    expect(parse("mine")).toEqual({ kind: "mine", ownerUserId: OWNER });
  });

  it("resolves the legacy household keyword to the visible household", () => {
    expect(parse("household")).toEqual({ kind: "household", householdId: HOUSEHOLD });
  });

  it("accepts an explicit visible household id", () => {
    expect(parse(HOUSEHOLD)).toEqual({ kind: "household", householdId: HOUSEHOLD });
  });

  it("rejects a household id the caller cannot see", () => {
    // The id list comes from the RLS-bound households query, so an id that is
    // missing from it is either someone else's or does not exist.
    expect(parse("hh-someone-else")).toEqual({ kind: "mine", ownerUserId: OWNER });
  });

  it("falls back to mine when the caller belongs to no household", () => {
    expect(parse("household", [])).toEqual({ kind: "mine", ownerUserId: OWNER });
  });

  it("takes the first value when the router supplies a repeated param", () => {
    expect(parse([HOUSEHOLD, "mine"])).toEqual({ kind: "household", householdId: HOUSEHOLD });
  });

  it("ignores surrounding whitespace and unknown values", () => {
    expect(parse("  household  ")).toEqual({ kind: "household", householdId: HOUSEHOLD });
    expect(parse("everyone")).toEqual({ kind: "mine", ownerUserId: OWNER });
  });
});

describe("serializeFinancialScope", () => {
  it("omits the param for personal scope so URLs stay clean", () => {
    expect(serializeFinancialScope({ kind: "mine", ownerUserId: OWNER })).toBeUndefined();
  });

  it("round-trips household scope", () => {
    const scope: FinancialScope = { kind: "household", householdId: HOUSEHOLD };
    const raw = serializeFinancialScope(scope);
    expect(raw).toBe(HOUSEHOLD);
    expect(parse(raw)).toEqual(scope);
  });
});

describe("scopeQueryUserId", () => {
  it("returns the owner id for personal scope so queries filter explicitly", () => {
    expect(scopeQueryUserId({ kind: "mine", ownerUserId: OWNER })).toBe(OWNER);
  });

  it("returns undefined for household scope so RLS decides visibility", () => {
    expect(scopeQueryUserId({ kind: "household", householdId: HOUSEHOLD })).toBeUndefined();
  });
});
