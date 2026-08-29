import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-29T10:00:00Z",
      health: {
        itemId: "item-1",
        institutionName: "Chase Bank",
        transactions: { state: "healthy", lastSuccessAt: "2026-08-29T10:00:00Z", safeErrorCode: null },
        investments: { state: "product_unavailable", lastSuccessAt: null, safeErrorCode: "PRODUCTS_NOT_SUPPORTED" },
        oldestTransactionDate: "2026-01-01",
        newestTransactionDate: "2026-08-29",
      },
    },
  ];

  it("renders empty message when no items are connected", () => {
    render(<BanksSection initialItems={[]} />);
    expect(screen.getByText("No banks connected.")).toBeDefined();
  });

  it("renders connected bank, health states, and triggers backfill action", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    render(<BanksSection initialItems={mockItems} />);
    expect(screen.getByText("Chase Bank")).toBeDefined();
    expect(screen.getByText("Healthy")).toBeDefined();
    expect(screen.getByText("Unsupported")).toBeDefined();

    const backfillBtn = screen.getByRole("button", { name: "Backfill" });
    expect(backfillBtn).toBeDefined();
    fireEvent.click(backfillBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/plaid/repair", expect.objectContaining({
        method: "POST",
      }));
    });
  });
});
