import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POST as mfaAuditPost } from "@/app/api/settings/mfa/route";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);
const suite = run ? describe : describe.skip;

let activeUser: unknown = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeSupabaseClient: any = null;

vi.mock("@/lib/http", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/http")>();
  return {
    ...original,
    requireUser: async () => {
      if (!activeUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return { user: activeUser, supabase: activeSupabaseClient };
    },
  };
});

suite("MFA auditing integration", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  let tempUserId = "";
  let tempUserClient: ReturnType<typeof createClient>;
  let tempUserObj: unknown;

  function clientWithMfa({
    factors,
    unenroll = vi.fn().mockResolvedValue({ error: null }),
  }: {
    factors: Array<{ id: string; status: string; friendly_name?: string }>;
    unenroll?: ReturnType<typeof vi.fn>;
  }) {
    return {
      from: (table: string) => tempUserClient.from(table),
      auth: {
        mfa: {
          listFactors: vi.fn().mockResolvedValue({
            data: { totp: factors, phone: [] },
            error: null,
          }),
          unenroll,
        },
      },
    };
  }

  beforeAll(async () => {
    // Create temporary user
    const { data, error } = await admin.auth.admin.createUser({
      email: `mfa-aud-${stamp}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (error) throw error;
    tempUserId = data.user.id;
    tempUserObj = data.user;

    tempUserClient = createClient(url!, publishable!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await tempUserClient.auth.signInWithPassword({
      email: `mfa-aud-${stamp}@example.com`,
      password: "Password123!",
    });
  });

  afterAll(async () => {
    if (tempUserId) {
      await admin.auth.admin.deleteUser(tempUserId);
    }
  });

  beforeEach(async () => {
    activeUser = null;
    activeSupabaseClient = null;
    await admin.from("audit_logs").delete().eq("user_id", tempUserId);
    await admin
      .from("profiles")
      .update({ mfa_enrolled: false })
      .eq("id", tempUserId);
  });

  it("returns 400 for invalid action or missing body", async () => {
    activeUser = tempUserObj;
    activeSupabaseClient = tempUserClient;

    const req1 = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const resp1 = await mfaAuditPost(req1);
    expect(resp1.status).toBe(400);

    const req2 = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: JSON.stringify({ action: "invalid-action", factorId: "f-123" }),
    });
    const resp2 = await mfaAuditPost(req2);
    expect(resp2.status).toBe(400);
  });

  it("records mfa_enroll action in audit_logs", async () => {
    activeUser = tempUserObj;
    activeSupabaseClient = clientWithMfa({
      factors: [{ id: `f-enr-${stamp}`, status: "verified" }],
    });

    const req = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: JSON.stringify({ action: "enroll", factorId: `f-enr-${stamp}` }),
    });
    const resp = await mfaAuditPost(req);
    expect(resp.status).toBe(200);

    // Verify audit log exists
    const { data: logs, error } = await admin
      .from("audit_logs")
      .select("action, metadata")
      .eq("user_id", tempUserId)
      .eq("action", "mfa_enroll");

    expect(error).toBeNull();
    expect(logs).toHaveLength(1);
    expect((logs![0].metadata as Record<string, unknown>).factorId).toBe(`f-enr-${stamp}`);
  });

  it("rejects enroll finalization when the factor is not verified", async () => {
    activeUser = tempUserObj;
    activeSupabaseClient = clientWithMfa({
      factors: [{ id: `f-unverified-${stamp}`, status: "unverified" }],
    });

    const req = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: JSON.stringify({ action: "enroll", factorId: `f-unverified-${stamp}` }),
    });
    const resp = await mfaAuditPost(req);
    expect(resp.status).toBe(400);

    const { data: profile } = await admin
      .from("profiles")
      .select("mfa_enrolled")
      .eq("id", tempUserId)
      .single();
    expect(profile?.mfa_enrolled).toBe(false);

    const { count } = await admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", tempUserId)
      .eq("action", "mfa_enroll");
    expect(count).toBe(0);
  });

  it("server-finalizes enroll by setting the profile flag and writing audit", async () => {
    activeUser = tempUserObj;
    activeSupabaseClient = clientWithMfa({
      factors: [{ id: `f-verified-${stamp}`, status: "verified" }],
    });

    const req = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: JSON.stringify({ action: "enroll", factorId: `f-verified-${stamp}` }),
    });
    const resp = await mfaAuditPost(req);
    expect(resp.status).toBe(200);

    const { data: profile } = await admin
      .from("profiles")
      .select("mfa_enrolled")
      .eq("id", tempUserId)
      .single();
    expect(profile?.mfa_enrolled).toBe(true);

    const { data: logs } = await admin
      .from("audit_logs")
      .select("action, metadata")
      .eq("user_id", tempUserId)
      .eq("action", "mfa_enroll");
    expect(logs).toHaveLength(1);
    expect((logs![0].metadata as Record<string, unknown>).factorId).toBe(`f-verified-${stamp}`);
  });

  it("records mfa_unenroll action in audit_logs", async () => {
    activeUser = tempUserObj;
    activeSupabaseClient = clientWithMfa({
      factors: [],
    });

    const req = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: JSON.stringify({ action: "unenroll", factorId: `f-un-${stamp}` }),
    });
    const resp = await mfaAuditPost(req);
    expect(resp.status).toBe(200);

    // Verify audit log exists
    const { data: logs, error } = await admin
      .from("audit_logs")
      .select("action, metadata")
      .eq("user_id", tempUserId)
      .eq("action", "mfa_unenroll");

    expect(error).toBeNull();
    expect(logs).toHaveLength(1);
    expect((logs![0].metadata as Record<string, unknown>).factorId).toBe(`f-un-${stamp}`);
  });

  it("server-finalizes unenroll by removing the factor and clearing profile when none remain", async () => {
    const unenroll = vi.fn().mockResolvedValue({ error: null });
    activeUser = tempUserObj;
    activeSupabaseClient = clientWithMfa({
      factors: [],
      unenroll,
    });

    await admin
      .from("profiles")
      .update({ mfa_enrolled: true })
      .eq("id", tempUserId);

    const req = new NextRequest("http://localhost/api/settings/mfa", {
      method: "POST",
      body: JSON.stringify({ action: "unenroll", factorId: `f-last-${stamp}` }),
    });
    const resp = await mfaAuditPost(req);
    expect(resp.status).toBe(200);
    expect(unenroll).toHaveBeenCalledWith({ factorId: `f-last-${stamp}` });

    const { data: profile } = await admin
      .from("profiles")
      .select("mfa_enrolled")
      .eq("id", tempUserId)
      .single();
    expect(profile?.mfa_enrolled).toBe(false);
  });
});
