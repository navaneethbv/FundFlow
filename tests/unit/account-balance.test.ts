import { describe, expect, it } from "vitest";
import {
  classifyBalanceSheetAmount,
  isLiabilityAccount,
  netWorthContribution,
} from "@/lib/account-balance";

describe("lib/account-balance", () => {
  describe("isLiabilityAccount", () => {
    it("identifies liability accounts correctly", () => {
      expect(isLiabilityAccount("credit")).toBe(true);
      expect(isLiabilityAccount("loan")).toBe(true);
      expect(isLiabilityAccount("debt")).toBe(true);
      expect(isLiabilityAccount("liability")).toBe(true);
      expect(isLiabilityAccount("other", "credit card")).toBe(true);
      expect(isLiabilityAccount("other", "auto loan")).toBe(true);
      expect(isLiabilityAccount("other", "mortgage")).toBe(true);
      expect(isLiabilityAccount("other", "student loan")).toBe(true);

      expect(isLiabilityAccount("depository")).toBe(false);
      expect(isLiabilityAccount("cash")).toBe(false);
      expect(isLiabilityAccount("investment")).toBe(false);
      expect(isLiabilityAccount(null)).toBe(false);
      expect(isLiabilityAccount(undefined)).toBe(false);
    });
  });

  describe("netWorthContribution", () => {
    it("contributes balance directly for asset accounts", () => {
      expect(netWorthContribution(100, "depository")).toBe(100);
      expect(netWorthContribution(-50, "depository")).toBe(-50);
      expect(netWorthContribution(0, "depository")).toBe(0);
      expect(netWorthContribution(null, "depository")).toBe(0);
    });

    it("contributes negative of balance for liability accounts", () => {
      expect(netWorthContribution(100, "credit")).toBe(-100);
      // Negative credit balance is a credit / asset to net worth:
      expect(netWorthContribution(-2.11, "credit")).toBe(2.11);
      expect(netWorthContribution(0, "credit")).toBe(-0);
      expect(netWorthContribution(null, "credit")).toBe(0);
    });
  });

  describe("classifyBalanceSheetAmount", () => {
    it("classifies positive credit balance as liability", () => {
      expect(classifyBalanceSheetAmount(100, "credit")).toEqual({
        kind: "liability",
        amount: 100,
      });
    });

    it("classifies negative credit balance (-$2.11) as asset credit", () => {
      expect(classifyBalanceSheetAmount(-2.11, "credit")).toEqual({
        kind: "asset",
        amount: 2.11,
      });
    });

    it("classifies positive cash balance as asset", () => {
      expect(classifyBalanceSheetAmount(500, "depository")).toEqual({
        kind: "asset",
        amount: 500,
      });
    });

    it("classifies negative cash balance as overdraft liability", () => {
      expect(classifyBalanceSheetAmount(-35, "depository")).toEqual({
        kind: "liability",
        amount: 35,
      });
    });

    it("handles null / NaN gracefully", () => {
      expect(classifyBalanceSheetAmount(null, "credit")).toEqual({
        kind: "liability",
        amount: 0,
      });
      expect(classifyBalanceSheetAmount(null, "depository")).toEqual({
        kind: "asset",
        amount: 0,
      });
    });
  });
});
