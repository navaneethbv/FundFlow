import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { refreshRecurringForItem, refreshRecurringForUser } from "@/lib/recurring";
import { storeItem, getItem } from "@/lib/plaid-service";

// Mock the Plaid client getter
const mockTransactionsRecurringGet = vi.fn();

vi.mock("@/lib/plaid", () => {
  return {
    getPlaidClient: () => {
      return {
        transactionsRecurringGet: mockTransactionsRecurringGet,
      };
    },
  };
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && secret);
const suite = run ? describe : describe.skip;

suite("recurring streams DB integration & mock Plaid", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  let userId = "";
  let itemDbId = "";
  const plaidItemId = `plaid-item-recur-${stamp}`;
  const inflowStreamId = `stream-in-${stamp}`;
  const outflowStreamId = `stream-out-${stamp}`;

  beforeAll(async () => {
    // Create temporary user
    const { data, error } = await admin.auth.admin.createUser({
      email: `plaid-recur-${stamp}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;

    // Create item
    itemDbId = await storeItem({
      userId,
      plaidItemId,
      accessToken: "dummy-token",
      institutionId: "ins_recur",
      institutionName: "Recur Bank",
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (userId) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  it("refreshes and saves recurring streams in the database", async () => {
    mockTransactionsRecurringGet.mockResolvedValue({
      data: {
        inflow_streams: [
          {
            stream_id: inflowStreamId,
            description: "Direct Deposit Employer",
            merchant_name: "Employer Corp",
            average_amount: { amount: 2000.0, iso_currency_code: "USD" },
            last_amount: { amount: 2000.0, iso_currency_code: "USD" },
            frequency: "bi-weekly",
            status: "active",
            personal_finance_category: { primary: "INCOME" },
            is_active: true,
          },
        ],
        outflow_streams: [
          {
            stream_id: outflowStreamId,
            description: "Netflix.com Subscription",
            merchant_name: "Netflix",
            average_amount: { amount: 15.49, iso_currency_code: "USD" },
            last_amount: { amount: 15.49, iso_currency_code: "USD" },
            frequency: "monthly",
            status: "active",
            personal_finance_category: { primary: "ENTERTAINMENT" },
            is_active: true,
          },
        ],
      },
    });

    const item = await getItem(userId, itemDbId);
    const count = await refreshRecurringForItem(item!);

    expect(mockTransactionsRecurringGet).toHaveBeenCalledWith({
      access_token: "dummy-token",
    });
    expect(count).toBe(2);

    // Verify DB records
    const { data: streams } = await admin
      .from("recurring_streams")
      .select("stream_id, stream_type, merchant_name, average_amount, frequency")
      .eq("user_id", userId)
      .order("stream_type");

    expect(streams).toHaveLength(2);

    const inflow = streams!.find((s) => s.stream_type === "inflow");
    expect(inflow).toBeTruthy();
    expect(inflow!.stream_id).toBe(inflowStreamId);
    expect(inflow!.merchant_name).toBe("Employer Corp");
    expect(Number(inflow!.average_amount)).toBe(2000.0);
    expect(inflow!.frequency).toBe("bi-weekly");

    const outflow = streams!.find((s) => s.stream_type === "outflow");
    expect(outflow).toBeTruthy();
    expect(outflow!.stream_id).toBe(outflowStreamId);
    expect(outflow!.merchant_name).toBe("Netflix");
    expect(Number(outflow!.average_amount)).toBe(15.49);
    expect(outflow!.frequency).toBe("monthly");
  });

  it("runs refreshRecurringForUser successfully", async () => {
    // When called again, should refresh and return counts
    mockTransactionsRecurringGet.mockResolvedValue({
      data: { inflow_streams: [], outflow_streams: [] },
    });

    const count = await refreshRecurringForUser(userId);
    expect(count).toBe(0);
  });
});
