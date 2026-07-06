import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { createClient } from "@supabase/supabase-js";

describe("getClientIp", () => {
  it("extracts the first IP from x-forwarded-for", () => {
    const req = new NextRequest("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178" },
    });
    expect(getClientIp(req)).toBe("203.0.113.195");
  });

  it("extracts x-real-ip if x-forwarded-for is missing", () => {
    const req = new NextRequest("http://localhost", {
      headers: { "x-real-ip": "203.0.113.196" },
    });
    expect(getClientIp(req)).toBe("203.0.113.196");
  });

  it("returns null if neither header is present", () => {
    const req = new NextRequest("http://localhost");
    expect(getClientIp(req)).toBeNull();
  });
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && secret);
const suite = run ? describe : describe.skip;

suite("writeAudit DB integration", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  let userId = "";

  beforeAll(async () => {
    // Create a temporary user for auditing
    const { data, error } = await admin.auth.admin.createUser({
      email: `audit-${stamp}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
  });

  afterAll(async () => {
    if (userId) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  it("successfully inserts an audit log row into the DB", async () => {
    const metadata = { testKey: `val-${stamp}` };
    const ip = "127.0.0.1";

    await writeAudit({
      userId,
      action: "login",
      metadata,
      ip,
    });

    // Check that it was inserted
    const { data, error } = await admin
      .from("audit_logs")
      .select("action, metadata, ip")
      .eq("user_id", userId)
      .eq("action", "login");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].action).toBe("login");
    expect(data![0].ip).toBe(ip);
    expect((data![0].metadata as Record<string, unknown>).testKey).toBe(metadata.testKey);
  });
});
