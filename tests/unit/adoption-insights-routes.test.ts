import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";
const state = vi.hoisted(() => ({
  flags: new Set<string>(),
  auth: vi.fn(),
  rate: vi.fn(),
  audit: vi.fn(),
  writer: vi.fn(),
}));
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (flag: string) => state.flags.has(flag),
}));
vi.mock("@/lib/http", async (original) => ({
  ...(await original<object>()),
  requireUser: () => state.auth(),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => state.rate(...args),
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => state.audit(...args),
  getClientIp: () => null,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => state.writer(),
}));
import { POST as acknowledge } from "@/app/api/insights/acknowledge/route";
import { POST as preferences } from "@/app/api/insights/preferences/route";
import { GET as history } from "@/app/api/rules/history/route";
import { GET as suggestion } from "@/app/api/rules/suggestion/route";
import { DELETE as clear } from "@/app/api/rules/effect/route";
const id = "11111111-1111-4111-8111-111111111111";
let reader: ReturnType<typeof clientStub>;
let writer: ReturnType<typeof clientStub>;
const req = (body: unknown = {}, query = "") =>
  new NextRequest(`https://fundflow.test/api/test${query}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  state.flags = new Set([
    "insightsFeed",
    "insightGenerators",
    "ruleRunHistory",
    "ruleSuggestions",
    "compoundRules",
  ]);
  reader = clientStub({
    notifications: { data: { id, read_at: null } },
    rule_runs: { data: [] },
    rule_changes: { data: [] },
    transactions: {
      data: {
        merchant_name: "Shop",
        name: "Raw",
        amount: -20,
        account_id: "a",
      },
    },
    transaction_annotations: { data: { updated_at: "2026-10-01" } },
  });
  writer = clientStub({
    transaction_annotations: { data: { transaction_id: id } },
  });
  state.auth.mockImplementation(async () => ({
    user: { id: "owner" },
    supabase: reader,
  }));
  state.writer.mockImplementation(() => writer);
  state.rate.mockResolvedValue(true);
});
describe("session-bound insight and history routes", () => {
  it.each([
    [acknowledge, "insightsFeed"],
    [preferences, "insightGenerators"],
    [history, "ruleRunHistory"],
    [suggestion, "ruleSuggestions"],
    [clear, "compoundRules"],
  ] as const)("refuses off entry point %s", async (handler, flag) => {
    state.flags.delete(flag);
    expect((await handler(req())).status).toBe(404);
    expect(reader.from).not.toHaveBeenCalled();
    expect(writer.from).not.toHaveBeenCalled();
  });
  it.each([acknowledge, preferences, history, suggestion, clear])(
    "never accepts a bearer token instead of a cookie session",
    async (handler) => {
      state.auth.mockResolvedValue(Response.json({}, { status: 401 }));
      const request = req();
      request.headers.set("authorization", "Bearer export-token");
      expect((await handler(request)).status).toBe(401);
    },
  );
  it.each([acknowledge, preferences, suggestion, clear])(
    "rate limits sensitive entry points",
    async (handler) => {
      state.rate.mockResolvedValue(false);
      expect((await handler(req())).status).toBe(429);
    },
  );
  it.each([
    null,
    {},
    { id: "bad", action: "acknowledge" },
    { id, action: "delete" },
  ])("validates acknowledgement %j", async (value) => {
    expect((await acknowledge(req(value))).status).toBe(400);
  });
  it.each(["acknowledge", "restore"])(
    "persists owner-only %s and audits it",
    async (action) => {
      expect((await acknowledge(req({ id, action }))).status).toBe(200);
      expect(reader.scopedToUser("notifications", "owner")).toBe(true);
      expect(reader.writtenTo("notifications")).toEqual({
        read_at: action === "restore" ? null : expect.any(String),
      });
      expect(state.audit).toHaveBeenCalled();
    },
  );
  it("handles missing, failed, and malformed acknowledgement requests", async () => {
    reader = clientStub({ notifications: { data: null } });
    expect((await acknowledge(req({ id, action: "restore" }))).status).toBe(
      404,
    );
    reader = clientStub({ notifications: { error: new Error("offline") } });
    expect((await acknowledge(req({ id, action: "restore" }))).status).toBe(
      500,
    );
    expect(
      (
        await acknowledge(
          new NextRequest("https://fundflow.test", {
            method: "POST",
            body: "bad",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it.each([null, [], {}, { bad: true }, { new_merchant: "true" }])(
    "rejects malformed preferences %j",
    async (value) => {
      expect((await preferences(req(value))).status).toBe(400);
    },
  );
  it("writes only named owner preferences and reports database errors", async () => {
    expect(
      (await preferences(req({ new_merchant: true, idle_cash: false }))).status,
    ).toBe(200);
    expect(reader.writtenTo("alert_preferences")).toEqual({
      user_id: "owner",
      new_merchant: true,
      idle_cash: false,
    });
    reader = clientStub({ alert_preferences: { error: new Error("offline") } });
    expect((await preferences(req({ idle_cash: true }))).status).toBe(500);
  });
  it("reads bounded owner history and transaction provenance, without foreign rows", async () => {
    expect(await (await history(req())).json()).toEqual({ runs: [] });
    expect(reader.scopedToUser("rule_runs", "owner")).toBe(true);
    expect(
      await (await history(req({}, `?transactionId=${id}`))).json(),
    ).toEqual({ changes: [] });
    expect(reader.scopedToUser("rule_changes", "owner")).toBe(true);
    expect((await history(req({}, "?transactionId=no"))).status).toBe(400);
    reader = clientStub({ rule_runs: { error: new Error("offline") } });
    expect((await history(req())).status).toBe(500);
    reader = clientStub({ rule_changes: { error: new Error("offline") } });
    expect((await history(req({}, `?transactionId=${id}`))).status).toBe(500);
  });
  it("suggests from the owner's facts only and refuses a missing prerequisite", async () => {
    expect(await (await suggestion(req({}, `?id=${id}`))).json()).toEqual({
      merchant: "Shop",
      name: "Raw",
      amount: 20,
      accountId: "a",
    });
    expect(reader.scopedToUser("transactions", "owner")).toBe(true);
    expect((await suggestion(req())).status).toBe(400);
    state.flags.delete("compoundRules");
    expect((await suggestion(req({}, `?id=${id}`))).status).toBe(404);
  });
  it("handles absent merchant/account data, missing transactions and failed reads", async () => {
    reader = clientStub({
      transactions: {
        data: { name: "Cash", amount: 1, manual_account_id: "manual" },
      },
    });
    expect(
      (await (await suggestion(req({}, `?id=${id}`))).json()).accountId,
    ).toBe("manual");
    reader = clientStub({ transactions: { data: null } });
    expect((await suggestion(req({}, `?id=${id}`))).status).toBe(404);
    reader = clientStub({ transactions: { error: new Error("offline") } });
    expect((await suggestion(req({}, `?id=${id}`))).status).toBe(500);
  });
  it("clears only derived effects with an owner and version filter", async () => {
    expect((await clear(req({ transactionId: id }))).status).toBe(200);
    expect(writer.scopedToUser("transaction_annotations", "owner")).toBe(true);
    expect(writer.callsOn("transaction_annotations")).toContainEqual({
      method: "eq",
      args: ["updated_at", "2026-10-01"],
    });
    expect(writer.writtenTo("transaction_annotations")).toEqual({
      rule_actions: null,
      updated_at: expect.any(String),
    });
    writer = clientStub({ transaction_annotations: { data: null } });
    expect((await clear(req({ transactionId: id }))).status).toBe(409);
  });
  it("handles effect input, missing annotations and failed reads/writes", async () => {
    expect((await clear(req())).status).toBe(400);
    reader = clientStub({ transaction_annotations: { data: null } });
    expect((await clear(req({ transactionId: id }))).status).toBe(404);
    reader = clientStub({
      transaction_annotations: { error: new Error("read") },
    });
    expect((await clear(req({ transactionId: id }))).status).toBe(500);
    reader = clientStub({
      transaction_annotations: { data: { updated_at: "now" } },
    });
    writer = clientStub({
      transaction_annotations: { error: new Error("write") },
    });
    expect((await clear(req({ transactionId: id }))).status).toBe(500);
  });
});
