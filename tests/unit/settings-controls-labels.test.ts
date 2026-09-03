import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

import ProfileSection from "@/components/settings/ProfileSection";
import DisplaySection from "@/components/settings/DisplaySection";
import ManualAccountsSection from "@/components/settings/ManualAccountsSection";
import MerchantRulesSection from "@/components/settings/MerchantRulesSection";
import ImportSection from "@/components/settings/ImportSection";
import ReceiptScanSection from "@/components/settings/ReceiptScanSection";

/** Assert the visible label's htmlFor targets exactly the rendered control id. */
function expectLinkedControl(html: string, labelText: string, controlId: string): void {
  expect(html, `control with id ${controlId} should render`).toContain(
    `id="${controlId}"`,
  );

  // `for="..."` only appears on <label> in server-rendered React markup, so a
  // match plus the visible text before its `</label>` is the full linkage.
  const forAttr = `for="${controlId}"`;
  const forIndex = html.indexOf(forAttr);
  expect(forIndex, `a label should carry ${forAttr}`).toBeGreaterThan(-1);

  const labelEnd = html.indexOf("</label>", forIndex);
  const labelSlice = html.slice(
    forIndex,
    labelEnd === -1 ? undefined : labelEnd,
  );
  expect(labelSlice, `label ${forAttr} should contain "${labelText}"`).toContain(
    labelText,
  );
}

describe("Settings control labels", () => {
  it("labels every Profile text and date input", () => {
    const html = renderToStaticMarkup(
      createElement(ProfileSection, {
        fullName: null,
        displayName: null,
        birthday: null,
        avatarUrl: null,
      }),
    );
    expectLinkedControl(html, "Full name", "profile-full-name");
    expectLinkedControl(html, "Display name", "profile-display-name");
    expectLinkedControl(html, "Birthday", "profile-birthday");
  });

  it("labels every Display select", () => {
    const html = renderToStaticMarkup(
      createElement(DisplaySection, {
        initialPrefs: {
          theme: "system",
          density: "comfortable",
          reducedMotion: "system",
          defaultPrivacyBlur: false,
        },
      }),
    );
    expectLinkedControl(html, "Theme", "display-theme");
    expectLinkedControl(html, "Density", "display-density");
    expectLinkedControl(html, "Reduced motion", "display-reduced-motion");
  });

  it("labels the manual-account add form and keeps per-account balance labels", () => {
    const html = renderToStaticMarkup(
      createElement(ManualAccountsSection, {
        initialAccounts: [
          {
            id: "acct-1",
            name: "Brokerage",
            account_type: "asset",
            balance: 1000,
            include_in_net_worth: true,
          },
        ],
      }),
    );
    expectLinkedControl(html, "Name", "manual-account-name");
    expectLinkedControl(html, "Type", "manual-account-type");
    expectLinkedControl(html, "Balance", "manual-account-balance");
    expect(html).toContain('aria-label="Balance for Brokerage"');
  });

  it("labels every merchant-rule control", () => {
    const html = renderToStaticMarkup(
      createElement(MerchantRulesSection, { initialRules: [] }),
    );
    expectLinkedControl(html, "Match", "rule-match-type");
    expectLinkedControl(html, "Pattern", "rule-pattern");
    expectLinkedControl(html, "Display name", "rule-display-name");
    expectLinkedControl(html, "Category", "rule-category");
    expectLinkedControl(html, "Tags", "rule-tags");
  });

  it("labels the import file input, account select, and date-format select", () => {
    const html = renderToStaticMarkup(
      createElement(ImportSection, {
        accounts: [{ id: "a1", name: "Checking", mask: "1234", kind: "account" }],
      }),
    );
    expectLinkedControl(html, "Drag and drop", "import-file");
    expectLinkedControl(html, "Into account", "import-account");
    expectLinkedControl(html, "Date format", "import-date-order");
  });

  it("labels the receipt file input through a visible label", () => {
    const html = renderToStaticMarkup(
      createElement(ReceiptScanSection, { enabled: true }),
    );
    expectLinkedControl(html, "Choose a receipt photo", "receipt-scan-file");
  });
});