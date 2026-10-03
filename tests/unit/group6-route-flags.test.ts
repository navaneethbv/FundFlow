import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET as getMappings, PUT as putMappings } from "@/app/api/settings/plaid-category-mappings/route";
import { POST as bayes } from "@/app/api/categorization/bayes/route";
import { POST as merge } from "@/app/api/merchants/merge/route";
import { requireUser } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { clientStub } from "../fixtures/supabase-query";

const enabled = vi.hoisted(() => vi.fn(() => true));
const serviceClient = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: enabled }));
vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ getClientIp: vi.fn(() => "127.0.0.1"), writeAudit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));

function request(path: string, body?: unknown): NextRequest {
  return new NextRequest(`https://app.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function putRequest(body: unknown): NextRequest {
  return new NextRequest("https://app.test/api/settings/plaid-category-mappings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Group 6 route flags and contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enabled.mockReturnValue(true);
    vi.mocked(writeAudit).mockResolvedValue(undefined);
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    serviceClient.rpc.mockReturnValue({ then: (resolve: (value: { data: null; error: null }) => unknown) => resolve({ data: null, error: null }) });
    vi.mocked(createServiceClient).mockReturnValue(serviceClient as never);
  });

  it("keeps all new endpoints unavailable while their flags are off", async () => {
    enabled.mockReturnValue(false);
    expect((await getMappings()).status).toBe(404);
    expect((await bayes(request("/api/categorization/bayes", {}))).status).toBe(404);
    expect((await merge(request("/api/merchants/merge", {}))).status).toBe(404);
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("lists mappings only for the authenticated user", async () => {
    const client = clientStub({ plaid_category_mappings: { data: [{ id: "m1", pfc_detailed: "FOOD.GROCERIES", display_category: "Groceries" }], error: null } });
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    const response = await getMappings();
    expect(response.status).toBe(200);
    expect(client.scopedToUser("plaid_category_mappings", "user-1")).toBe(true);
    await expect(response.json()).resolves.toEqual({ mappings: [{ id: "m1", pfc_detailed: "FOOD.GROCERIES", display_category: "Groceries" }] });
  });

  it("returns an empty mapping list when the database has no rows", async () => {
    const client = clientStub({ plaid_category_mappings: { data: null, error: null } });
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    await expect((await getMappings()).json()).resolves.toEqual({ mappings: [] });
  });

  it("returns an error response when listing mappings fails", async () => {
    const client = clientStub({ plaid_category_mappings: { data: null, error: { message: "read failed" } } });
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    expect((await getMappings()).status).toBe(500);
  });

  it("returns the auth response before reading mappings", async () => {
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never);
    expect((await getMappings()).status).toBe(401);
    expect((await putMappings(putRequest({ mappings: [] }))).status).toBe(401);
  });

  it("rejects invalid mappings before deleting the existing set", async () => {
    const client = clientStub();
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    const response = await putMappings(putRequest({ mappings: [{ pfc_detailed: " ", display_category: "Food" }] }));
    expect(response.status).toBe(400);
    expect(client.callsOn("plaid_category_mappings")).toHaveLength(0);
  });

  it("replaces mappings with normalized, user-scoped rows and audits the write", async () => {
    const client = clientStub();
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    const response = await putMappings(putRequest({ mappings: [{ pfc_detailed: " food.groceries ", display_category: " Groceries " }] }));
    expect(response.status).toBe(200);
    expect(client.callsOnRpc("replace_plaid_category_mappings")).toEqual([[{ p_user_id: "user-1", p_mappings: [{ pfc_detailed: "FOOD.GROCERIES", display_category: "Groceries" }] }]]);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "plaid_category_mappings_updated", userId: "user-1" }));
  });

  it("accepts an empty mapping set without inserting rows", async () => {
    const client = clientStub();
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    expect((await putMappings(putRequest({ mappings: [] }))).status).toBe(200);
    expect(client.callsOnRpc("replace_plaid_category_mappings")).toEqual([[{ p_user_id: "user-1", p_mappings: [] }]]);
  });

  it("rejects malformed mapping entries and duplicate codes", async () => {
    const client = clientStub();
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    expect((await putMappings(putRequest({ mappings: [{ pfc_detailed: 42, display_category: "Food" }] }))).status).toBe(400);
    expect((await putMappings(putRequest({ mappings: [{ pfc_detailed: "FOOD", display_category: "Food" }, { pfc_detailed: "food", display_category: "Other" }] }))).status).toBe(400);
    const tooMany = Array.from({ length: 201 }, (_, index) => ({ pfc_detailed: `FOOD.${index}`, display_category: "Food" }));
    expect((await putMappings(putRequest({ mappings: tooMany }))).status).toBe(400);
  });

  it("treats malformed JSON as an empty mapping body", async () => {
    const client = clientStub();
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    const malformed = new NextRequest("https://app.test/api/settings/plaid-category-mappings", { method: "PUT", body: "{", headers: { "Content-Type": "application/json" } });
    expect((await putMappings(malformed)).status).toBe(400);
  });

  it("returns an error when the atomic mapping replacement fails", async () => {
    const client = clientStub({ replace_plaid_category_mappings: { data: null, error: { message: "replacement failed" } } });
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    expect((await putMappings(putRequest({ mappings: [{ pfc_detailed: "FOOD", display_category: "Food" }] }))).status).toBe(500);
  });

  it("returns the rate-limit response before reading transactions", async () => {
    const client = clientStub();
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const response = await bayes(request("/api/categorization/bayes", {}));
    expect(response.status).toBe(429);
    expect(client.callsOn("transactions")).toHaveLength(0);
  });

  it("returns the auth response before reading Bayes inputs", async () => {
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never);
    expect((await bayes(request("/api/categorization/bayes", {}))).status).toBe(401);
  });

  it("returns an ineligible Bayes result without writing annotations", async () => {
    const client = clientStub({ transactions: { data: [{ id: "t1", merchant_name: "Shop", name: "Shop", pfc_primary: "FOOD" }], error: null }, transaction_annotations: { data: [], error: null } });
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    const response = await bayes(request("/api/categorization/bayes", {}));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ eligible: false, reason: "not_enough_rows" });
    expect(client.writtenTo("transaction_annotations")).toBeUndefined();
  });

  it("uses annotation categories and returns an eligible result with no suggestions", async () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ id: `t${index}`, merchant_name: "Shop", name: "Purchase", pfc_primary: index % 2 ? "FOOD" : "TRAVEL" }));
    const client = clientStub({ transactions: { data: rows, error: null }, transaction_annotations: { data: [{ transaction_id: "t0", display_category: "Custom" }], error: null } });
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    const response = await bayes(request("/api/categorization/bayes", {}));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ eligible: true, suggestions: [] });
  });

  it("applies confident Bayes suggestions with provenance", async () => {
    const labeled = Array.from({ length: 20 }, (_, index) => ({ id: `t${index}`, merchant_name: index % 2 ? "Grocery Market" : "Fuel Station", name: "Purchase", pfc_primary: index % 2 ? "FOOD" : "TRANSPORTATION" }));
    const client = clientStub({ transactions: { data: [...labeled, { id: "unknown", merchant_name: "Grocery Market", name: "Purchase", pfc_primary: null }], error: null }, transaction_annotations: { data: [], error: null } });
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    const response = await bayes(request("/api/categorization/bayes", {}));
    expect(response.status).toBe(200);
    expect(client.writtenTo("transaction_annotations")).toEqual(expect.arrayContaining([expect.objectContaining({ user_id: "user-1", transaction_id: "unknown", classification_source: "bayes" })]));
  });

  it("handles Bayes query and write failures", async () => {
    const transactionFailure = clientStub({ transactions: { data: null, error: { message: "transaction read failed" } } });
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: transactionFailure as never } as never);
    expect((await bayes(request("/api/categorization/bayes", {}))).status).toBe(500);

    const annotationFailure = clientStub({ transactions: { data: [], error: null }, transaction_annotations: { data: null, error: { message: "annotation read failed" } } });
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: annotationFailure as never } as never);
    expect((await bayes(request("/api/categorization/bayes", {}))).status).toBe(500);

    const missingAnnotations = clientStub({ transactions: { data: [], error: null }, transaction_annotations: { data: null, error: null } });
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: missingAnnotations as never } as never);
    expect((await bayes(request("/api/categorization/bayes", {}))).status).toBe(200);

    const trainingRows: Array<{ id: string; merchant_name: string; name: string; pfc_primary: string | null }> = Array.from({ length: 20 }, (_, index) => ({ id: `t${index}`, merchant_name: index % 2 ? "Grocery" : "Fuel", name: "Purchase", pfc_primary: index % 2 ? "FOOD" : "TRANSPORTATION" }));
    const writeFailure = clientStub({ transactions: { data: [...trainingRows, { id: "unknown", merchant_name: "Grocery", name: "Purchase", pfc_primary: null }], error: null }, transaction_annotations: { data: [], error: null } });
    const annotationTable = writeFailure.from("transaction_annotations");
    annotationTable.upsert = () => ({ then: (resolve: (value: { data: null; error: { message: string } }) => unknown) => resolve({ data: null, error: { message: "annotation write failed" } }) }) as never;
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: writeFailure as never } as never);
    expect((await bayes(request("/api/categorization/bayes", {}))).status).toBe(500);
  });

  it("validates merchant merges before calling the service function", async () => {
    const client = clientStub();
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    const response = await merge(request("/api/merchants/merge", { source_merchant: "Same", target_merchant: "same" }));
    expect(response.status).toBe(400);
    expect(serviceClient.rpc).not.toHaveBeenCalled();
  });

  it("rejects merchant merges with missing names", async () => {
    const client = clientStub();
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    expect((await merge(request("/api/merchants/merge", { source_merchant: "Old Shop" }))).status).toBe(400);
    expect((await merge(request("/api/merchants/merge", { source_merchant: " ", target_merchant: "New Shop" }))).status).toBe(400);
    const malformed = new NextRequest("https://app.test/api/merchants/merge", { method: "POST", body: "{", headers: { "Content-Type": "application/json" } });
    expect((await merge(malformed)).status).toBe(400);
  });

  it("calls the scoped merchant merge function and audits it", async () => {
    const client = clientStub();
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    const response = await merge(request("/api/merchants/merge", { source_merchant: "Old Shop", target_merchant: "New Shop" }));
    expect(response.status).toBe(200);
    expect(serviceClient.rpc).toHaveBeenCalledWith("merge_merchants", { p_user_id: "user-1", p_source_merchant: "Old Shop", p_target_merchant: "New Shop" });
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "merchant_alias_saved", userId: "user-1" }));
  });

  it("returns an error response when a merchant merge fails", async () => {
    const client = clientStub();
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    serviceClient.rpc.mockReturnValue({ then: (resolve: (value: { data: null; error: { message: string } }) => unknown) => resolve({ data: null, error: { message: "merge failed" } }) });
    expect((await merge(request("/api/merchants/merge", { source_merchant: "Old Shop", target_merchant: "New Shop" }))).status).toBe(500);
  });

  it("returns the auth response before reading a new route body", async () => {
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never);
    expect((await merge(request("/api/merchants/merge", {}))).status).toBe(401);
  });
});
