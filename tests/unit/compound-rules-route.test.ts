import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";
const state = vi.hoisted(() => ({
  enabled: true,
  auth: vi.fn(),
  rate: vi.fn(),
  audit: vi.fn(),
  writer: vi.fn(),
  rules: vi.fn(),
  candidates: vi.fn(),
  simulate: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => state.enabled,
}));
vi.mock("@/lib/http", async (original) => ({
  ...(await original<object>()),
  requireUser: () => state.auth(),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => state.rate() }));
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => state.audit(...args),
  getClientIp: () => null,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => state.writer(),
}));
vi.mock("@/lib/compound-rule-service", () => ({
  loadRules: (...args: unknown[]) => state.rules(...args),
  loadRuleCandidates: (...args: unknown[]) => state.candidates(...args),
  simulateCompoundRules: (...args: unknown[]) => state.simulate(...args),
  applyCompoundRules: (...args: unknown[]) => state.apply(...args),
}));
import { GET, POST } from "@/app/api/rules/compound/route";
const id = "11111111-1111-4111-8111-111111111111";
const body = {
  action: "save",
  conditions: {
    op: "and",
    children: [{ field: "merchant", operator: "equals", value: "Shop" }],
  },
  actions: { category: "Food" },
};
const req = (value: unknown) =>
  new NextRequest("https://fundflow.test/api/rules/compound", {
    method: "POST",
    body: JSON.stringify(value),
  });
let writer: ReturnType<typeof clientStub>;
beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = true;
  state.auth.mockResolvedValue({ user: { id: "owner" }, supabase: {} });
  state.rate.mockResolvedValue(true);
  state.rules.mockResolvedValue([{ id }]);
  state.candidates.mockResolvedValue([{ id: "tx" }]);
  state.simulate.mockReturnValue({ matchedCount: 1 });
  state.apply.mockResolvedValue(1);
  writer = clientStub({ merchant_rules: { data: { id } } });
  state.writer.mockImplementation(() => writer);
});
it("requires a session and gates both methods when off", async () => {
  state.auth.mockResolvedValue(Response.json({}, { status: 401 }));
  expect((await GET()).status).toBe(401);
  expect((await POST(req(body))).status).toBe(401);
  state.auth.mockResolvedValue({ user: { id: "owner" } });
  state.enabled = false;
  expect((await GET()).status).toBe(404);
  expect((await POST(req(body))).status).toBe(404);
  expect(state.rules).not.toHaveBeenCalled();
});
it("reads owner rules and surfaces failed reads", async () => {
  expect(await (await GET()).json()).toEqual({ rules: [{ id }] });
  expect(state.rules).toHaveBeenCalledWith({}, "owner");
  state.rules.mockRejectedValue(new Error("read"));
  expect((await GET()).status).toBe(500);
});
it("rate limits and bounds malformed payloads", async () => {
  state.rate.mockResolvedValue(false);
  expect((await POST(req(body))).status).toBe(429);
  state.rate.mockResolvedValue(true);
  expect(
    (
      await POST(
        new NextRequest("https://fundflow.test", {
          method: "POST",
          body: "bad",
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await POST(req({ ...body, padding: "x".repeat(17000) }))).status,
  ).toBe(413);
});
it.each([
  null,
  {},
  { action: "delete" },
  { action: "preview", start: "2026-02-30", end: "2026-03-01" },
  { action: "apply", start: "2026-10-02", end: "2026-10-01" },
  { ...body, conditions: null },
  { ...body, actions: {} },
  { ...body, id: "bad" },
  { ...body, enabled: 1 },
])("rejects invalid contract %j", async (value) => {
  expect((await POST(req(value))).status).toBe(400);
  expect(writer.from).not.toHaveBeenCalled();
});
it("creates a validated rule without rewriting any existing rule", async () => {
  expect((await POST(req(body))).status).toBe(200);
  expect(writer.writtenTo("merchant_rules")).toMatchObject({
    user_id: "owner",
    conditions: body.conditions,
    actions: body.actions,
    enabled: true,
    match_type: "compound",
  });
  expect(state.audit).toHaveBeenCalled();
});
it("updates only an existing owner's rule and preserves disabled state", async () => {
  expect((await POST(req({ ...body, id, enabled: false }))).status).toBe(200);
  expect(writer.scopedToUser("merchant_rules", "owner")).toBe(true);
  expect(writer.writtenTo("merchant_rules")).toMatchObject({ enabled: false });
  state.rules.mockResolvedValue([]);
  expect((await POST(req({ ...body, id }))).status).toBe(404);
});
it("refuses rule count overflow and failed writes", async () => {
  state.rules.mockResolvedValue(Array(100).fill({ id }));
  expect((await POST(req(body))).status).toBe(400);
  state.rules.mockResolvedValue([]);
  writer = clientStub({ merchant_rules: { error: new Error("write") } });
  expect((await POST(req(body))).status).toBe(500);
});
it("previews without writes, then explicitly applies the ordered rules", async () => {
  const value = { action: "preview", start: "2026-10-01", end: "2026-10-10" };
  expect(await (await POST(req(value))).json()).toEqual({
    evaluated: 1,
    matched: 1,
    changed: 0,
  });
  expect(state.apply).not.toHaveBeenCalled();
  expect(
    (await POST(req({ ...value, action: "apply", ruleId: id }))).status,
  ).toBe(200);
  expect(state.apply).toHaveBeenCalledWith(
    writer,
    "owner",
    "manual",
    [{ id }],
    [{ id: "tx" }],
    id,
  );
});
it("previews suggested conditions without persisting or accepting them as an application", async () => {
  const value = {
    action: "preview",
    start: "2026-10-01",
    end: "2026-10-10",
    conditions: body.conditions,
  };
  expect((await POST(req(value))).status).toBe(200);
  expect(state.simulate).toHaveBeenCalledWith(
    [expect.objectContaining({ id: "preview", conditions: body.conditions })],
    [{ id: "tx" }],
  );
  expect((await POST(req({ ...value, action: "apply" }))).status).toBe(400);
  expect((await POST(req({ ...value, conditions: {} }))).status).toBe(400);
  expect((await POST(req({ ...value, ruleId: "unknown" }))).status).toBe(400);
});
