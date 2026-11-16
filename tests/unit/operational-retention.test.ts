import { expect, it } from "vitest";
import { pruneOperationalData } from "@/lib/operational-retention";
it("scopes every deletion and preserves security and event tombstones", async () => {
  const calls: Array<{ table: string; filters: unknown[] }> = [];
  const service = { from: (table: string) => {
    const call = { table, filters: [] as unknown[] }; calls.push(call);
    const chain = { delete: () => chain, eq: (k: string, v: unknown) => { call.filters.push(["eq", k, v]); return chain; }, neq: (k: string, v: unknown) => { call.filters.push(["neq", k, v]); return chain; }, is: (k: string, v: unknown) => { call.filters.push(["is", k, v]); return chain; }, lt: async (k: string, v: unknown) => { call.filters.push(["lt", k, v]); return { error: null }; } }; return chain;
  } };
  await pruneOperationalData(service as never, "owner", Date.parse("2030-01-15T12:00Z"));
  expect(calls).toHaveLength(6);
  expect(calls.find(c => c.table === "ai_insights")?.filters).toContainEqual(["lt", "created_at", "2029-07-19T12:00:00.000Z"]);
  for (const call of calls) expect(call.filters).toContainEqual(["eq", "user_id", "owner"]);
  expect(calls.find(c => c.table === "user_session_records")?.filters).toContainEqual(["is", "revoked_at", null]);
  expect(calls.find(c => c.table === "notifications")?.filters).toContainEqual(["is", "subject_key", null]);
});
