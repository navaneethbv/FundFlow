import { describe, expect, it } from "vitest";
import {
  parseMonarchBudgetCsv,
  parseMonarchGoalCsv,
} from "@/lib/import-monarch-config";

describe("Phase 4: Monarch Budget and Goal Migration", () => {
  describe("parseMonarchBudgetCsv", () => {
    it("parses categories, monthly limits, groups, and rollover flags", () => {
      const csv = `Category,Group,Budgeted,Rollover
Groceries,Food & Dining,600,true
Restaurants,Food & Dining,300,false
Rent,Housing,1500,false`;

      const parsed = parseMonarchBudgetCsv(csv);
      expect(parsed).toHaveLength(3);
      expect(parsed[0]).toEqual({
        category: "Groceries",
        group: "Food & Dining",
        monthlyLimit: 600,
        rolloverEnabled: true,
      });
      expect(parsed[1]).toEqual({
        category: "Restaurants",
        group: "Food & Dining",
        monthlyLimit: 300,
        rolloverEnabled: false,
      });
      expect(parsed[2]).toEqual({
        category: "Rent",
        group: "Housing",
        monthlyLimit: 1500,
        rolloverEnabled: false,
      });
    });

    it("handles empty or invalid inputs gracefully", () => {
      expect(parseMonarchBudgetCsv("")).toEqual([]);
      expect(parseMonarchBudgetCsv("invalid header,foo,bar")).toEqual([]);
    });
  });

  describe("parseMonarchGoalCsv", () => {
    it("parses target balances, dates, monthly contributions, and linked accounts", () => {
      const csv = `Goal Name,Goal Type,Target Amount,Target Date,Monthly Contribution,Linked Account
Emergency Fund,save_up,10000,2026-12-31,500,High Yield Savings
Student Loan,pay_down,25000,2028-06-30,400,Loan Account`;

      const parsed = parseMonarchGoalCsv(csv);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({
        name: "Emergency Fund",
        type: "save_up",
        targetAmount: 10000,
        targetDate: "2026-12-31",
        monthlyContribution: 500,
        linkedAccountName: "High Yield Savings",
      });
      expect(parsed[1]).toEqual({
        name: "Student Loan",
        type: "pay_down",
        targetAmount: 25000,
        targetDate: "2028-06-30",
        monthlyContribution: 400,
        linkedAccountName: "Loan Account",
      });
    });
  });
});
