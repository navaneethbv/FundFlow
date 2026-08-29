import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BanksSection from "@/components/settings/BanksSection";
import type { PlaidItemRow } from "@/lib/types";
import type { InstitutionSyncHealth } from "@/lib/sync-health";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/settings/ReconnectBankButton", () => ({
  default: () => <button>Reconnect</button>,
}));

describe("BanksSection UI", () => {
  const mockItems: (PlaidItemRow & { health?: InstitutionSyncHealth })[] = [
    {
      id: "item-1",
      user_id: "user-1",
      plaid_item_id: "plaid-item-1",
      institution_id: "ins_1",
      institution_name: "Chase Bank",
      status: "active",
      error_code: null,
      sync_cursor: "cursor-1",
      access_token_ciphertext: "enc",
      access_token_iv: "iv",
      access_token_tag: "tag",
      health: {
        plaidItemId: "item-1",
        institutionName: "Chase Bank",
        transactions: {
          state: "healthy",
          lastSuccessAt: "2026-08-29T10:00:00Z",
          lastAttemptAt: "2026-08-29T10:00:00Z",
          safeErrorCode: null,
        },
        investments: {
          state: "product_unavailable",
          lastSuccessAt: null,
          lastAttemptAt: null,
          safeErrorCode: "PRODUCTS_NOT_SUPPORTED",
        },
        oldestTransactionDate: "2026-01-01",
        newestTransactionDate: "2026-08-29",
        accountsUpdatedAt: "2026-08-29T10:00:00Z",
      },
    },
  ];

  it("renders empty message when no items are connected", () => {
    const html = renderToStaticMarkup(<BanksSection initialItems={[]} />);
    expect(html).toContain("No banks connected.");
  });

  it("renders connected bank, health states, and backfill action", () => {
    const html = renderToStaticMarkup(<BanksSection initialItems={mockItems} />);
    expect(html).toContain("Chase Bank");
    expect(html).toContain("Healthy");
    expect(html).toContain("Unsupported");
    expect(html).toContain("Backfill");
  });
});
