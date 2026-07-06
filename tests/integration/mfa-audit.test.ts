import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
    activeSupabaseClient = tempUserClient;

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

  it("records mfa_unenroll action in audit_logs", async () => {
    activeUser = tempUserObj;
    activeSupabaseClient = tempUserClient;

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
});
