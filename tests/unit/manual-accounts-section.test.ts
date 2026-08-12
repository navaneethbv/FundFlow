import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

import ManualAccountsSection from "@/components/settings/ManualAccountsSection";

describe("ManualAccountsSection", () => {
  it("renders an accessible balance editor for each manual account", () => {
    const html = renderToStaticMarkup(
      createElement(ManualAccountsSection, {
        initialAccounts: [
          {
            id: "manual-1",
            name: "Brokerage",
            account_type: "investment",
            balance: 1250,
            include_in_net_worth: true,
          },
        ],
      }),
    );

    expect(html).toContain('aria-label="Balance for Brokerage"');
    expect(html).toContain('value="1250"');
    expect(html).toContain(">Save balance<");
    expect(html).toContain("Include in net worth");
  });

  it("disables an account toggle while its update is in flight", () => {
    const source = readFileSync(
      "components/settings/ManualAccountsSection.tsx",
      "utf8",
    );

    expect(source).toContain("toggleBusyId");
    expect(source).toContain("disabled={toggleBusyId === account.id}");
  });
});
