import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), select: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: () => ({ upsert: mocks.upsert }) }) }));
vi.mock("@/lib/push", () => ({ sendPushToUser: mocks.push }));
import { createNotificationsBatch } from "@/lib/notifications";
const candidate = { type: "large_transaction" as const, subjectKey: "purchase", details: { title: "Large transaction", body: "Details" } };
beforeEach(() => { vi.clearAllMocks(); mocks.upsert.mockReturnValue({ select: mocks.select }); mocks.select.mockResolvedValue({ data: [], error: null }); });
it("filters preferences before writing", async () => {
  await createNotificationsBatch("owner", [candidate], null);
  await createNotificationsBatch("owner", [candidate], { large_transaction: false });
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it("batches distinct identities and ignores database conflicts without duplicate pushes", async () => {
  await createNotificationsBatch("owner", [candidate, candidate], { large_transaction: true });
  expect(mocks.upsert).toHaveBeenCalledWith([expect.objectContaining({ user_id: "owner", subject_key: "purchase" })], { onConflict: "user_id,type,subject_key", ignoreDuplicates: true });
  expect(mocks.upsert.mock.calls[0][0][0]).not.toHaveProperty("readAt");
  expect(mocks.upsert.mock.calls[0][0][0]).toHaveProperty("read_at", null);
  expect(mocks.push).not.toHaveBeenCalled();
});
it("pushes only notifications actually inserted", async () => {
  mocks.select.mockResolvedValue({ data: [{ title: "New", body: "Details" }], error: null });
  await createNotificationsBatch("owner", [candidate], {});
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith("owner", { title: "New", body: "Details" });
});
it("surfaces insert errors", async () => {
  mocks.select.mockResolvedValue({ data: null, error: new Error("unavailable") });
  await expect(createNotificationsBatch("owner", [candidate], {})).rejects.toThrow("unavailable");
});
