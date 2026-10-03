import { describe, expect, it } from "vitest";
import { parseAssetInput } from "@/lib/manual-assets";

const valid = { name: " Home ", assetKind: "property", value: 100000.01, valuationDate: "2026-01-31", valueSource: " Appraisal ", ownershipPercentage: 50 };
describe("asset input", () => {
  it("preserves entered gross values and trims text", () => {
    expect(parseAssetInput(valid, "2026-10-02")).toEqual({ ...valid, name: "Home", valueSource: "Appraisal", purchaseDate: null, purchasePrice: null, growth: null });
  });
  it.each([null, [], {}, { ...valid, name: " " }, { ...valid, name: "x".repeat(121) },
    { ...valid, assetKind: "cash" }, { ...valid, value: -1 }, { ...valid, value: 1e12 }, { ...valid, value: 1.001 },
    { ...valid, value: "1" }, { ...valid, value: Infinity }, { ...valid, value: NaN },
    { ...valid, valuationDate: "2026-02-30" }, { ...valid, valuationDate: "2026-13-01" }, { ...valid, valuationDate: "2126-01-01" },
    { ...valid, valuationDate: "1900-01-01" }, { ...valid, ownershipPercentage: 0 }, { ...valid, ownershipPercentage: 101 },
    { ...valid, valueSource: "" }, { ...valid, valueSource: "x".repeat(121) },
    { ...valid, purchasePrice: -1 }, { ...valid, purchaseDate: "2026-02-01" }, { ...valid, purchaseDate: "bad" },
    { ...valid, id: "bad" }, { ...valid, id: "91000000-0000-4000-8000-000000000001", version: 0 },
    { ...valid, growth: [] }, { ...valid, growth: 1 }, { ...valid, growth: {} },
    ...[-101, 101, NaN, "10"].map((amount) => ({ ...valid, growth: { kind: "percent", amount, period: "month" } })),
    { ...valid, growth: { kind: "percent", amount: 10, period: "month", startDate: "bad" } },
  ])("rejects invalid input %#", (input) => expect(typeof parseAssetInput(input, "2026-10-02")).toBe("string"));
  it("accepts negative growth, explicit version, purchase data and a later start", () => {
    const input = { ...valid, id: "91000000-0000-4000-8000-000000000001", version: 2, purchaseDate: "2025-01-01", purchasePrice: 120000,
      growth: { kind: "absolute", amount: -12.34, period: "year", startDate: "2027-01-01" } };
    expect(parseAssetInput(input, "2026-10-02")).toMatchObject(input.growth ? { growth: input.growth, version: 2 } : {});
    expect(parseAssetInput({ ...valid, growth: { kind: "percent", amount: -100, period: "month" } }, "2026-10-02"))
      .toMatchObject({ growth: { startDate: null, amount: -100 } });
  });
});
