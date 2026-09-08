import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientStub } from "../fixtures/supabase-query";
let service = clientStub();
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => service }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/audit", () => ({ writeAudit: async () => undefined }));
import { GET } from "@/app/api/calendar/[token]/route";
const stream = { id: "stream", merchant_name: "Gym", stream_type: "outflow", status: "MATURE", is_active: true,
  frequency: "MONTHLY", predicted_next_date: "2026-09-22", average_amount: 40, last_amount: 42, user_amount: 51.25 };
const seeds = { calendar_tokens: { data: { user_id: "owner", include_amounts: true } }, profiles: { data: { timezone: "America/Los_Angeles" } } };
const feed = () => GET(new Request("http://localhost"), { params: Promise.resolve({ token: "a".repeat(40) }) });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-08T00:30:00Z")); });
afterEach(() => vi.useRealTimers());
describe("calendar occurrence parity", () => {
  it("uses predicted dates and user amounts, includes manual and scheduled entries, and scopes all data", async () => {
    service = clientStub({ ...seeds, recurring_streams: { data: [stream] },
      manual_recurring_items: { data: [{ id: "manual", name: "Rent", amount: 1200, frequency: "monthly", next_date: "2026-09-10", item_type: "expense", enabled: true }] },
      scheduled_transactions: { data: [{ id: "one", merchant: "Dentist", amount: 75, kind: "debit", scheduled_date: "2026-09-07" }] } });
    const response = await feed(); expect(response.status).toBe(200); const text = await response.text();
    expect(text).toContain("DTSTART;VALUE=DATE:20260922"); expect(text).toContain("51.25");
    expect(text).not.toContain("DTSTART;VALUE=DATE:20260915");
    expect(text).toContain("Rent"); expect(text).toContain("DTSTART;VALUE=DATE:20260910");
    expect(text).toContain("Dentist"); expect(text).toContain("DTSTART;VALUE=DATE:20260907");
    expect(text.match(/SUMMARY:.*Dentist/g)).toHaveLength(1);
    for (const table of ["recurring_streams", "manual_recurring_items", "accounts", "scheduled_transactions", "recurring_stream_transactions"]) {
      expect(service.scopedToUser(table, "owner")).toBe(true);
    }
  });
  it("omits inactive, dismissed, tombstoned, and unanchored streams", async () => {
    service = clientStub({ ...seeds, recurring_streams: { data: [
      { ...stream, id: "inactive", merchant_name: "Inactive", is_active: false },
      { ...stream, id: "dismissed", merchant_name: "Dismissed", dismissed_at: "2026-09-01" },
      { ...stream, id: "gone", merchant_name: "Gone", status: "TOMBSTONED" },
      { ...stream, id: "undated", merchant_name: "Undated", predicted_next_date: null },
    ] } });
    const text = await (await feed()).text(); expect(text).not.toContain("BEGIN:VEVENT");
  });
  it.each(["recurring_streams", "manual_recurring_items", "scheduled_transactions"])("does not publish a partial feed when %s fails", async (table) => {
    service = clientStub({ ...seeds, [table]: { error: { code: "XX000", message: "unavailable" } } });
    expect((await feed()).status).toBe(500);
  });
  it("paginates scheduled entries and hides all amounts when disabled", async () => {
    service = clientStub({ ...seeds, calendar_tokens: { data: { user_id: "owner", include_amounts: false } },
      scheduled_transactions: { data: Array.from({ length: 501 }, (_, id) => ({ id: `scheduled-${id}`, merchant: `Entry ${id}`, kind: "credit", amount: 9876.54, scheduled_date: "2026-09-20" })) } });
    const text = await (await feed()).text(); expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(501);
    expect(text).not.toContain("9876.54"); expect(text).toContain("Entry 500");
  });
});
