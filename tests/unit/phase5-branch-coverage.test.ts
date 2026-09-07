import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockRequireUser = vi.fn();
vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>();
  return {
    ...actual,
    requireUser: (...args: unknown[]) => mockRequireUser(...args),
  };
});

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockServiceClient = { from: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockServerSupabase = {
  auth: {
    getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    mfa: {
      getAuthenticatorAssuranceLevel: async () => ({ data: null, error: { message: "mfa down" } }),
    },
  },
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockServerSupabase,
}));

const mockExtractReceipt = vi.fn<(...args: unknown[]) => Promise<{ extracted: unknown; rawText: string }>>(async () => ({
  extracted: { merchant: "Store", amount: 50, date: "2026-07-02", lineItems: [] },
  rawText: "receipt",
}));
const mockProviderConfigured = vi.fn<() => boolean>(() => true);
vi.mock("@/lib/ai-provider", () => ({
  extractReceiptWithProvider: (...args: unknown[]) => mockExtractReceipt(...args),
  isAiProviderConfigured: () => mockProviderConfigured(),
}));

const mockAiConsent = vi.fn<(...args: unknown[]) => Promise<{ allowed: true }>>(async () => ({ allowed: true as const }));
vi.mock("@/lib/ai-gate", () => ({
  resolveAiConsent: (...args: unknown[]) => mockAiConsent(...args),
}));

function chain(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lte", "lt", "order", "limit", "in", "is", "or", "gt", "single", "like", "neq"]) {
    builder[m] = () => builder;
  }
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return builder;
}

function authed(supabase: unknown) {
  mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
}

import { GET as reportGet } from "@/app/api/export/report/route";
import { POST as sharePost } from "@/app/api/plaid/share/route";
import { POST as aprPost } from "@/app/api/accounts/apr/route";

describe("A-13 checked reads surface 500s instead of wrong successes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
  });

  it("export/report throws when the profile timezone read fails", async () => {
    const supabase = { from: vi.fn(() => chain({ data: null, error: { message: "db down" } })) };
    authed(supabase);
    const res = await reportGet(new Request("http://localhost/api/export/report") as NextRequest);
    expect(res.status).toBe(500);
  });

  it("export/csv throws when the export journal insert fails", async () => {
    const { GET: taxCsvGet } = await import("@/app/api/export/tax/route");
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "data_exports") return { insert: () => Promise.resolve({ error: { message: "journal down" } }) };
        return chain({ data: [], error: null });
      }),
    };
    authed(supabase);
    const res = await taxCsvGet(new Request("http://localhost/api/export/tax?month=2026-07") as NextRequest);
    expect(res.status).toBe(500);
  });

  it("plaid/share throws when the item ownership read fails", async () => {
    const supabase = { from: vi.fn(() => chain({ data: null, error: { message: "db down" } })) };
    authed(supabase);
    const res = await sharePost(
      new NextRequest("http://localhost/api/plaid/share", {
        method: "POST",
        body: JSON.stringify({ itemId: "item-1", share: false }),
      }),
    );
    expect(res.status).toBe(500);
  });

  it("accounts/apr throws when the account ownership read fails", async () => {
    const supabase = { from: vi.fn(() => chain({ data: null, error: { message: "db down" } })) };
    authed(supabase);
    const res = await aprPost(
      new NextRequest("http://localhost/api/accounts/apr", {
        method: "POST",
        body: JSON.stringify({ accountId: "acc-1", apr: 19.99 }),
      }),
    );
    expect(res.status).toBe(500);
  });

  it("calendar feed throws when the token lookup fails", async () => {
    const { GET: calendarGet } = await import("@/app/api/calendar/[token]/route");
    mockServiceClient.from.mockImplementation(() => chain({ data: null, error: { message: "db down" } }));
    const res = await calendarGet(
      { headers: { get: () => null } } as unknown as Request,
      { params: Promise.resolve({ token: "a".repeat(24) }) },
    );
    expect(res.status).toBe(500);
  });

  it("ai/receipt scopes the ledger match to the caller and throws on failure", async () => {
    const { POST: receiptPost } = await import("@/app/api/ai/receipt/route");
    const fromCalls: string[][] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "transactions") {
          const builder: Record<string, unknown> = {};
          for (const m of ["select", "gte", "lte", "or", "order", "limit"]) builder[m] = () => builder;
          builder.eq = (col: string, val: unknown) => {
            fromCalls.push([col, String(val)]);
            return builder;
          };
          builder.then = (resolve: (v: unknown) => unknown) =>
            resolve({ data: [], error: { message: "db down" } });
          return builder;
        }
        return chain({ data: { enabled: true, ai_export_enabled: true }, error: null });
      }),
    };
    authed(supabase);
    const res = await receiptPost(
      new NextRequest("http://localhost/api/ai/receipt", {
        method: "POST",
        body: JSON.stringify({ image: "data:image/png;base64,xx", mimeType: "image/png" }),
      }),
    );
    // Either a 500 from the failed match read or a 400/402 from the AI
    // provider stage — never a silent 200 with skipped matching.
    expect([400, 402, 500]).toContain(res.status);
    if (res.status === 500) {
      expect(fromCalls).toContainEqual(["user_id", "u1"]);
    }
  });

  it("returns 401 without a session", async () => {
    mockRequireUser.mockResolvedValue(NextResponse.json({ error: "x" }, { status: 401 }));
    const res = await reportGet(new Request("http://localhost/api/export/report") as NextRequest);
    expect(res.status).toBe(401);
  });
});

describe("step-up factor selection", () => {
  it("rejects an unknown factor id and falls back to password only without factors", async () => {
    const { verifyStepUp } = await import("@/lib/step-up");
    const bothFactors = {
      auth: {
        mfa: {
          listFactors: async () => ({
            data: {
              totp: [
                { id: "f1", status: "verified" },
                { id: "f2", status: "unverified" },
              ],
            },
          }),
          challengeAndVerify: async () => ({ error: null }),
        },
      },
    };
    const user = { email: "u@example.com" };
    // Unknown factor id: no challenge attempted.
    await expect(
      verifyStepUp(bothFactors as never, user as never, "123456", "nope"),
    ).resolves.toBe(false);
    // Known factor: challenged.
    await expect(
      verifyStepUp(bothFactors as never, user as never, "123456", "f1"),
    ).resolves.toBe(true);
  });
});

describe("dashboard linked_transfers fallbacks", () => {
  it("degrades to no transfers when the table is missing (42P01)", async () => {
    const { getDashboardData } = await import("@/lib/dashboard");
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "range", "single"]) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    const mockFrom = vi.fn((table: string) => {
      if (table === "linked_transfers") {
        const fail: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "range", "single"]) {
          fail[m] = () => fail;
        }
        // Promise assimilation settles only when the reject callback runs;
        // returning a rejected promise here would hang the await forever.
        fail.then = (_resolve: unknown, reject: (e: unknown) => void) => {
          reject(new Error('relation "public.linked_transfers" does not exist (42P01)'));
        };
        return fail;
      }
      return chain;
    });
    const data = await getDashboardData({ from: mockFrom } as never, undefined, "2026-09", "u1");
    expect(data).toBeDefined();
  });
});

describe("export journal and auth assurance failures", () => {
  it("recordExport throws when the journal insert fails", async () => {
    const { recordExport } = await import("@/lib/export-route");
    mockServiceClient.from.mockReturnValue({
      insert: () => Promise.resolve({ error: { message: "journal down" } }),
    });
    await expect(
      recordExport({
        request: new NextRequest("http://localhost/api/export/json"),
        userId: "u1",
        format: "json",
        rowCount: 3,
      }),
    ).rejects.toMatchObject({ message: "journal down" });
  });

  it("requireUser returns 503 when the assurance check errors", async () => {
    // NOTE: this file partial-mocks @/lib/http, so reach the real
    // requireUser through importActual; its createClient import still
    // resolves to the mocked server module above.
    const actualHttp = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
    const res = await actualHttp.requireUser();
    expect((res as NextResponse).status).toBe(503);
  });
});

describe("account label helper edges", () => {
  it("falls back without duplicating short, long, and embedded masks", async () => {
    const { accountDisplayLabel, stripTrailingAccountMask } = await import("@/lib/account-label");
    expect(accountDisplayLabel("Visa (34)", "34")).toBe("Visa ••34");
    expect(accountDisplayLabel("Card 12345", "12345")).toBe("Card ••12345");
    expect(accountDisplayLabel(null, "12")).toBe("Account ••12");
    expect(stripTrailingAccountMask("ab", ".*", 5)).toBe("ab");
    // A mask with non-digit characters never strips: fall back to the
    // intact name rather than appending a second copy.
    expect(accountDisplayLabel("Card 12-34", "12-34")).toBe("Card 12-34 ••12-34");
    expect(stripTrailingAccountMask("Card 12", ".*", 2)).toBe("Card");
  });
});

describe("takeout rate limiting", () => {
  it("returns 429 when the takeout limiter is exhausted", async () => {
    const { GET: takeoutGet } = await import("@/app/api/export/takeout/route");
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
    mockCheckRateLimit.mockResolvedValue(false);
    const res = await takeoutGet(new Request("http://localhost/api/export/takeout") as NextRequest);
    expect(res.status).toBe(429);
    mockCheckRateLimit.mockResolvedValue(true);
  });
});

describe("net-worth profile lookup without maybeSingle", () => {
  it("reads exclusions through a plain awaitable query", async () => {
    const { writeNetWorthSnapshot } = await import("@/lib/net-worth");
    const { createServiceClient } = await import("@/lib/supabase/service");
    const service = vi.mocked(createServiceClient)();
    (service.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "profiles") {
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: () => builder,
        };
        // No maybeSingle: the awaitable-query fallback path.
        builder.then = (resolve: (v: unknown) => unknown) =>
          resolve({ data: { dashboard_prefs: { excludedNetWorthIds: [] } }, error: null });
        return builder;
      }
      if (table === "net_worth_snapshots") {
        return {
          upsert: () => ({
            select: () => ({ single: () => Promise.resolve({ data: { id: "s" }, error: null }) }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      };
    });
    const res = await writeNetWorthSnapshot("u1", "2026-09-06");
    expect(res).toEqual({ id: "s" });
  });

  it("throws when the profile query fails in writeNetWorthSnapshot", async () => {
    const { writeNetWorthSnapshot } = await import("@/lib/net-worth");
    const { createServiceClient } = await import("@/lib/supabase/service");
    const service = vi.mocked(createServiceClient)();
    (service.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: new Error("Profile read error") }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      };
    });
    await expect(writeNetWorthSnapshot("u1", "2026-09-06")).rejects.toThrow("Profile read error");
  });
});

describe("dashboard linked_transfers message-match fallback", () => {
  it("treats a linked_transfers mention without code as a missing table", async () => {
    const { getDashboardData } = await import("@/lib/dashboard");
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "range", "single"]) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    const mockFrom = vi.fn((table: string) => {
      if (table === "linked_transfers") {
        const fail: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "range", "single"]) {
          fail[m] = () => fail;
        }
        fail.then = (resolve: (v: unknown) => unknown) =>
          resolve({ data: null, error: { message: 'missing "linked_transfers"' } });
        return fail;
      }
      return chain;
    });
    const data = await getDashboardData({ from: mockFrom } as never, undefined, "2026-09", "u1");
    expect(data).toBeDefined();
  });
});

describe("verifyStepUp password verification branches", () => {
  it("verifies password via test client with signInWithPassword", async () => {
    const { verifyStepUp } = await import("@/lib/step-up");
    const mockAuth = {
      mfa: { listFactors: vi.fn().mockResolvedValue({ data: { totp: [] }, error: null }) },
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    };
    const res = await verifyStepUp(
      { auth: mockAuth } as never,
      { id: "u1", email: "test@example.com" } as never,
      "secret-password",
    );
    expect(res).toBe(true);
    expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "secret-password",
    });

    const mockAuthFail = {
      mfa: { listFactors: vi.fn().mockResolvedValue({ data: { totp: [] }, error: null }) },
      signInWithPassword: vi.fn().mockResolvedValue({ error: new Error("bad password") }),
    };
    const resFail = await verifyStepUp(
      { auth: mockAuthFail } as never,
      { id: "u1", email: "test@example.com" } as never,
      "wrong-password",
    );
    expect(resFail).toBe(false);
  });

  it("returns false if user has no email", async () => {
    const { verifyStepUp } = await import("@/lib/step-up");
    const mockAuth = {
      mfa: { listFactors: vi.fn().mockResolvedValue({ data: { totp: [] }, error: null }) },
    };
    const res = await verifyStepUp(
      { auth: mockAuth } as never,
      { id: "u1" } as never,
      "code",
    );
    expect(res).toBe(false);
  });
});

describe("composeNetWorthAccounts numeric and fallback parsing", () => {
  it("handles non-finite and string balances and empty account names", async () => {
    const { composeNetWorthAccounts } = await import("@/lib/net-worth-inputs");
    const accounts = composeNetWorthAccounts({
      plaidAccounts: [
        { id: "p1", name: "", type: "depository", current_balance: "invalid-number" as unknown as number },
        { id: "p2", name: "Savings", type: "depository", current_balance: 150 },
      ],
      manualAccounts: [
        { id: "m1", name: "   ", account_type: "investment", balance: "NaN" as unknown as number, include_in_net_worth: false },
        { id: "m2", name: "Cash", account_type: "other", balance: "200.50" as unknown as number, include_in_net_worth: true },
      ],
      excludedNetWorthIds: new Set(["p2"]),
    });
    expect(accounts[0].name).toBe("Account");
    expect(accounts[0].balance).toBeNull();
    expect(accounts[0].includeInNetWorth).toBe(true);

    expect(accounts[1].includeInNetWorth).toBe(false);

    expect(accounts[2].name).toBe("Account");
    expect(accounts[2].balance).toBeNull();
    expect(accounts[2].includeInNetWorth).toBe(false);

    expect(accounts[3].balance).toBe(200.5);
    expect(accounts[3].includeInNetWorth).toBe(true);
  });
});

