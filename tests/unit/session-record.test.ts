import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordSession } from "@/lib/session-record";
const read = vi.fn();
const insert = vi.fn();
const update = vi.fn();
function client() {
  const chain = { select: () => chain, eq: vi.fn(() => chain), is: () => chain, lt: update, maybeSingle: read, upsert: (...args: unknown[]) => { insert(...args); return chain; }, update: () => chain };
  return { from: () => chain } as never;
}
beforeEach(() => { vi.clearAllMocks(); update.mockResolvedValue({ error: null }); });
describe("session creation claim", () => {
  it("claims an alert only for the request that inserts", async () => {
    const row = { revoked_at: null, last_seen_at: new Date().toISOString() };
    read.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: row });
    expect(await recordSession(client(), "u", "s", "UA")).toEqual({ revoked: false, created: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u", session_id: "s" }), { onConflict: "user_id,session_id", ignoreDuplicates: true });
    read.mockResolvedValue({ data: row });
    expect(await recordSession(client(), "u", "s", "UA")).toEqual({ revoked: false, created: false });
    expect(update).not.toHaveBeenCalled();
  });
  it("rechecks revocation after losing an insert race", async () => {
    read.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: { revoked_at: "2026-01-01" } });
    expect(await recordSession(client(), "u", "s", null)).toEqual({ revoked: true, created: false });
  });
  it("throttles last seen writes to five minutes", async () => {
    read.mockResolvedValue({ data: { revoked_at: null, last_seen_at: new Date(Date.now() - 600_000).toISOString() } });
    await recordSession(client(), "u", "s", null);
    expect(update).toHaveBeenCalled();
  });
  it("fails closed on read and insert errors", async () => {
    read.mockResolvedValueOnce({ error: new Error("read") });
    await expect(recordSession(client(), "u", "s", null)).rejects.toThrow("read");
    read.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ error: new Error("insert") });
    await expect(recordSession(client(), "u", "s", null)).rejects.toThrow("insert");
  });
});

it("fails closed if an insert race cannot be resolved", async () => {
  read.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ error: new Error("raced read") });
  await expect(recordSession(client(), "u", "s", null)).rejects.toThrow("raced read");
  read.mockResolvedValue({ data: null });
  await expect(recordSession(client(), "u", "s", null)).rejects.toThrow("Session record unavailable");
});
it("surfaces an activity update outage", async () => {
  read.mockResolvedValue({ data: { revoked_at: null, last_seen_at: "2020-01-01" } });
  update.mockResolvedValue({ error: new Error("activity write") });
  await expect(recordSession(client(), "u", "s", null)).rejects.toThrow("activity write");
});
