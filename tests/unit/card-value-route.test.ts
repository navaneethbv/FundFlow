import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { PATCH } from "@/app/api/settings/card-value/route";
import { requireUser } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { clientStub } from "../fixtures/supabase-query";
import type { CardValueTerms } from "@/lib/card-value";

const featureEnabled = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: featureEnabled }));
vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), getClientIp: vi.fn(() => "127.0.0.1") }));

const terms: CardValueTerms[] = [{
  id: "membership-1",
  membershipName: "Travel membership",
  cardName: "Travel card",
  annualFee: 95,
  baselineAnnualFee: 0,
  anniversaryDate: "2026-01-01",
  confirmedOn: "2026-01-01",
  rewardTiers: [{ id: "base", label: "All eligible spend", rate: 0.02, cap: null, eligibleCategories: [] }],
  statementCredits: [],
  perks: [],
}];

function request(body: unknown): NextRequest {
  return new NextRequest("https://app.test/api/settings/card-value", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("card value terms route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureEnabled.mockReturnValue(true);
    vi.mocked(writeAudit).mockResolvedValue(undefined);
  });

  it("stays unavailable while the terms flag is off", async () => {
    featureEnabled.mockReturnValue(false);
    const response = await PATCH(request({ terms }));
    expect(response.status).toBe(404);
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("returns the auth response before reading the body", async () => {
    vi.mocked(requireUser).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never);
    const response = await PATCH(request({ terms }));
    expect(response.status).toBe(401);
  });

  it("rejects invalid terms before writing", async () => {
    const client = clientStub();
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    const response = await PATCH(request({ terms: [{ annualFee: -1 }] }));
    expect(response.status).toBe(400);
    expect(client.writtenTo("profiles")).toBeUndefined();
  });

  it("writes only the caller's terms and audits the change", async () => {
    const client = clientStub({ profiles: { data: null, error: null } });
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    const response = await PATCH(request({ terms }));
    expect(response.status).toBe(200);
    expect(client.scopedToUser("profiles", "user-1")).toBe(false);
    expect(client.callsOn("profiles")).toContainEqual({ method: "eq", args: ["id", "user-1"] });
    expect(client.writtenTo("profiles")).toEqual({ card_value_terms: terms });
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "card_value_terms_updated", userId: "user-1" }));
  });

  it("returns an error response when the profile update fails", async () => {
    const client = clientStub({ profiles: { data: null, error: { message: "profile update failed" } } });
    vi.mocked(requireUser).mockResolvedValue({ user: { id: "user-1" }, supabase: client as never } as never);
    expect((await PATCH(request({ terms }))).status).toBe(500);
  });
});
