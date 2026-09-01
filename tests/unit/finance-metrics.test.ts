import { describe, expect, it } from "vitest";
import { computeSavingsRate } from "@/lib/finance-metrics";

describe("lib/finance-metrics", () => {
  describe("computeSavingsRate", () => {
    it("computes positive savings rate", () => {
      // Income $5000, Spend $3000 -> (2000 / 5000) * 100 = 40%
      expect(computeSavingsRate(5000, 3000)).toBe(40);
    });

    it("computes break-even savings rate", () => {
      expect(computeSavingsRate(5000, 5000)).toBe(0);
    });

    it("computes negative savings rate when spending exceeds income", () => {
      // Income $121.80, Spend $13729.41 -> ((121.80 - 13729.41) / 121.80) * 100 = -11172.09%
      expect(computeSavingsRate(121.8, 13729.41)).toBe(-11172.09);

      // Annual: Income $71866.97, Spend $100456.92 -> ((71866.97 - 100456.92) / 71866.97) * 100 = -39.78%
      expect(computeSavingsRate(71866.97, 100456.92)).toBe(-39.78);
    });

    it("returns null when income is zero or negative", () => {
      expect(computeSavingsRate(0, 1000)).toBeNull();
      expect(computeSavingsRate(-500, 1000)).toBeNull();
      expect(computeSavingsRate(null, 1000)).toBeNull();
      expect(computeSavingsRate(undefined, 1000)).toBeNull();
    });
  });
});
