import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/auth/callback/route";

const mockExchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  }),
}));

vi.mock("@/lib/log", () => ({
  logError: vi.fn(),
}));

describe("app/auth/callback/route GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to login with missing_code when code is missing", async () => {
    const req = new NextRequest("https://app.fundflow.test/auth/callback");
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.fundflow.test/login?error=missing_code");
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("redirects to login with confirmation_failed when exchange fails", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: new Error("invalid code") });
    const req = new NextRequest("https://app.fundflow.test/auth/callback?code=bad-code");
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.fundflow.test/login?error=confirmation_failed");
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("bad-code");
  });

  it("redirects to /dashboard on successful session exchange", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ data: { session: {} }, error: null });
    const req = new NextRequest("https://app.fundflow.test/auth/callback?code=good-code");
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.fundflow.test/dashboard");
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("good-code");
  });
});
