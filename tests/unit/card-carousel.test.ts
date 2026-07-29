import { describe, it, expect } from "vitest";
import React from "react";
import CardCarousel from "@/components/dashboard/CardCarousel";
import type { AccountSummary } from "@/lib/dashboard";

describe("CardCarousel", () => {
  it("returns null when accounts list is empty", () => {
    const res = CardCarousel({ accounts: [] });
    expect(res).toBeNull();
  });

  it("renders carousel section with accounts", () => {
    const accounts: AccountSummary[] = [
      {
        id: "acc-1",
        name: "Sapphire Preferred",
        official_name: "Chase Sapphire Preferred",
        mask: "4321",
        type: "credit",
        subtype: "credit card",
        current_balance: 1250.5,
        available_balance: null,
        credit_limit: 5000,
        iso_currency_code: "USD",
        plaid_item_id: "item-1",
        apr: 0.22,
      },
    ];

    const element = CardCarousel({
      accounts,
      selectedAccountId: undefined,
      activeView: "monitor",
    });

    expect(element).not.toBeNull();
    expect(React.isValidElement(element)).toBe(true);
  });

  it("renders clear filter button when selectedAccountId is provided", () => {
    const accounts: AccountSummary[] = [
      {
        id: "acc-1",
        name: "Checking Account",
        official_name: "Everyday Checking",
        mask: "1111",
        type: "depository",
        subtype: "checking",
        current_balance: 500,
        available_balance: 500,
        credit_limit: null,
        iso_currency_code: "USD",
        plaid_item_id: "item-1",
        apr: null,
      },
    ];

    const element = CardCarousel({
      accounts,
      selectedAccountId: "acc-1",
      activeView: "plan",
      extraParams: { scope: "household" },
    });

    expect(element).not.toBeNull();
  });
});
