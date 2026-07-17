import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSyncAllForUser = vi.fn();
vi.mock("@/lib/sync", () => ({
  syncAllForUser: (...args: unknown[]) => mockSyncAllForUser(...args),
}));

const mockRefreshRecurringForUser = vi.fn();
vi.mock("@/lib/recurring", () => ({
  refreshRecurringForUser: (...args: unknown[]) =>
    mockRefreshRecurringForUser(...args),
}));

const mockWriteNetWorthSnapshot = vi.fn();
vi.mock("@/lib/net-worth", () => ({
  writeNetWorthSnapshot: (...args: unknown[]) =>
    mockWriteNetWorthSnapshot(...args),
}));

const mockProcessNotificationsForUser = vi.fn();
vi.mock("@/lib/notifications", () => ({
  processNotificationsForUser: (...args: unknown[]) =>
    mockProcessNotificationsForUser(...args),
}));

const mockSendDailyDigestEmail = vi.fn();
vi.mock("@/lib/reporting", () => ({
  sendDailyDigestEmail: (...args: unknown[]) => mockSendDailyDigestEmail(...args),
}));

const mockAlertCronFailure = vi.fn();
vi.mock("@/lib/cron-alert", () => ({
  alertCronFailure: (...args: unknown[]) => mockAlertCronFailure(...args),
}));

const mockServiceClient = {
  from: vi.fn(),
  auth: {
    admin: {
      getUserById: vi.fn(),
    },
  },
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockSafeEqual = vi.fn();
vi.mock("@/lib/crypto", () => ({
  safeEqual: (...args: unknown[]) => mockSafeEqual(...args),
}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: { cronSecret: "test-secret" },
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const mockErrorResponse = vi.fn((context, err) => {
  console.error("MOCKED CRON SYNC ERROR:", context, err);
  return new Response("error", { status: 500 });
});
vi.mock("@/lib/http", () => ({
  errorResponse: (context: string, err: unknown) => mockErrorResponse(context, err),
}));

import { GET } from "@/app/api/cron/sync/route";
import { NextRequest } from "next/server";

describe("GET /api/cron/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if secret does not match", async () => {
    mockSafeEqual.mockReturnValue(false);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer wrong" },
    });
    const res = await GET(request);
    expect(res.status).toBe(401);
  });

  it("syncs all users and sends digest email if there are notifications", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "plaid_items") {
        data = [{ user_id: "u1" }];
      } else if (table === "profiles") {
        const q = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(),
        };
        q.maybeSingle.mockResolvedValue({
          data: { daily_digest_email_enabled: true },
          error: null,
        });
        return q;
      } else if (table === "notifications") {
        data = [
          { type: "low_cash_forecast", title: "Low Cash", body: "Warning" },
        ];
      }

      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown[]; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data, error: null }).then(onfulfilled);
      return query;
    });

    mockServiceClient.auth.admin.getUserById.mockResolvedValue({
      data: { user: { email: "u1@test.com" } },
      error: null,
    });

    const res = await GET(request);
    expect(res.status).toBe(200);
    expect(mockSyncAllForUser).toHaveBeenCalledWith("u1");
    expect(mockSendDailyDigestEmail).toHaveBeenCalledWith(
      "u1@test.com",
      [{ type: "low_cash_forecast", title: "Low Cash", body: "Warning" }],
      expect.any(String),
      expect.any(String),
    );
  });

  it("alerts the admin when a user's sync fails", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "plaid_items") {
        data = [{ user_id: "u1" }, { user_id: "u2" }];
      } else if (table === "profiles") {
        const q = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(),
        };
        q.maybeSingle.mockResolvedValue({
          data: { daily_digest_email_enabled: true },
          error: null,
        });
        return q;
      }

      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown[]; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data, error: null }).then(onfulfilled);
      return query;
    });

    mockSyncAllForUser.mockImplementation((userId: string) => {
      if (userId === "u1") {
        return Promise.reject(new Error("ITEM_LOGIN_REQUIRED"));
      }
      return Promise.resolve();
    });

    const res = await GET(request);
    expect(res.status).toBe(200);
    expect(mockAlertCronFailure).toHaveBeenCalledWith("daily-sync", {
      failed: 1,
      total: 2,
      firstError: "ITEM_LOGIN_REQUIRED",
    });
  });

  it("reduces a non-code exception message to the error's class name", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "plaid_items") {
        data = [{ user_id: "u1" }, { user_id: "u2" }];
      } else if (table === "profiles") {
        const q = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(),
        };
        q.maybeSingle.mockResolvedValue({
          data: { daily_digest_email_enabled: true },
          error: null,
        });
        return q;
      }

      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown[]; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data, error: null }).then(onfulfilled);
      return query;
    });

    mockSyncAllForUser.mockImplementation((userId: string) => {
      if (userId === "u1") {
        return Promise.reject(
          new Error("db error: Key (plaid_transaction_id)=(abc) already exists"),
        );
      }
      return Promise.resolve();
    });

    const res = await GET(request);
    expect(res.status).toBe(200);
    expect(mockAlertCronFailure).toHaveBeenCalledWith("daily-sync", {
      failed: 1,
      total: 2,
      firstError: "Error",
    });
  });

  it("does not alert when every user syncs cleanly", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "plaid_items") {
        data = [{ user_id: "u1" }];
      } else if (table === "profiles") {
        const q = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(),
        };
        q.maybeSingle.mockResolvedValue({
          data: { daily_digest_email_enabled: true },
          error: null,
        });
        return q;
      }

      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown[]; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data, error: null }).then(onfulfilled);
      return query;
    });

    mockSyncAllForUser.mockResolvedValue(undefined);

    const res = await GET(request);
    expect(res.status).toBe(200);
    expect(mockAlertCronFailure).not.toHaveBeenCalled();
  });

  it("filters notifications for daily_digest_email_enabled: false", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "plaid_items") {
        data = [{ user_id: "u1" }];
      } else if (table === "profiles") {
        const q = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(),
        };
        q.maybeSingle.mockResolvedValue({
          data: { daily_digest_email_enabled: false },
          error: null,
        });
        return q;
      } else if (table === "notifications") {
        data = [
          { type: "broken_bank", title: "Broken Bank", body: "Fix it" },
          { type: "low_cash_forecast", title: "Low Cash", body: "Warning" },
        ];
      }

      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data, error: null }).then(onfulfilled);
      return query;
    });

    mockServiceClient.auth.admin.getUserById.mockResolvedValue({
      data: { user: { email: "u1@test.com" } },
      error: null,
    });

    const res = await GET(request);
    expect(res.status).toBe(200);
    expect(mockSendDailyDigestEmail).toHaveBeenCalledWith(
      "u1@test.com",
      [{ type: "broken_bank", title: "Broken Bank", body: "Fix it" }],
      expect.any(String),
      expect.any(String),
    );
  });

  it("logs digest errors and inserts notification on SMTP configuration error in prod settings", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer test-secret" },
    });

    const mockInsert = vi.fn().mockResolvedValue({ error: null });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "plaid_items") {
        data = [{ user_id: "u1" }];
      } else if (table === "profiles") {
        const q = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(),
        };
        q.maybeSingle.mockResolvedValue({
          data: { daily_digest_email_enabled: true },
          error: null,
        });
        return q;
      } else if (table === "notifications") {
        data = [
          { type: "low_cash_forecast", title: "Low Cash", body: "Warning" },
        ];
      }

      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        insert: mockInsert,
        then: undefined as unknown as (onfulfilled: (value: { data: unknown; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data, error: null }).then(onfulfilled);
      return query;
    });

    mockServiceClient.auth.admin.getUserById.mockResolvedValue({
      data: { user: { email: "u1@test.com" } },
      error: null,
    });

    mockSendDailyDigestEmail.mockRejectedValue(new Error("SMTP is not configured"));

    const res = await GET(request);
    expect(res.status).toBe(200);
    expect(mockLogError).toHaveBeenCalledWith("cron.sync.digest", expect.any(Error));
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: "u1",
      type: "broken_bank",
      severity: "danger",
      title: "Daily digest email skipped",
      body: "We could not send your daily digest email because SMTP is not configured in production settings.",
    });
  });

  it("alerts admin and returns 500 when fetching users fails", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation(() => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data: null, error: new Error("DB Query failed") }).then(onfulfilled);
      return query;
    });

    const res = await GET(request);
    expect(res.status).toBe(500);
    expect(mockAlertCronFailure).toHaveBeenCalledWith("daily-sync", {
      failed: 1,
      total: 1,
      firstError: "Error",
    });
    expect(mockErrorResponse).toHaveBeenCalledWith("cron.sync", expect.any(Error));
  });

  it("logs digest error when profile select fails", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "plaid_items") {
        data = [{ user_id: "u1" }];
      } else if (table === "profiles") {
        const q = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error("Profile DB Error") }),
        };
        return q;
      }

      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data, error: null }).then(onfulfilled);
      return query;
    });

    const res = await GET(request);
    expect(res.status).toBe(200);
    expect(mockLogError).toHaveBeenCalledWith("cron.sync.digest", expect.any(Error));
  });

  it("logs digest error when notifications select fails", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "plaid_items") {
        data = [{ user_id: "u1" }];
      } else if (table === "profiles") {
        const q = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { daily_digest_email_enabled: true }, error: null }),
        };
        return q;
      } else if (table === "notifications") {
        const query = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          then: undefined as unknown as (onfulfilled: (value: { data: unknown; error: unknown }) => unknown) => unknown,
        };
        query.then = (onfulfilled) =>
          Promise.resolve({ data: null, error: new Error("Notification DB Error") }).then(onfulfilled);
        return query;
      }

      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data, error: null }).then(onfulfilled);
      return query;
    });

    const res = await GET(request);
    expect(res.status).toBe(200);
    expect(mockLogError).toHaveBeenCalledWith("cron.sync.digest", expect.any(Error));
  });

  it("logs pruning errors if they fail", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "plaid_items") {
        data = [{ user_id: "u1" }];
      }

      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) => {
        if (table === "sync_jobs") {
          return Promise.resolve({ error: new Error("Pruning jobs failed") }).then(onfulfilled);
        }
        if (table === "rate_limit_counters") {
          return Promise.resolve({ error: new Error("Pruning counters failed") }).then(onfulfilled);
        }
        return Promise.resolve({ data, error: null }).then(onfulfilled);
      };
      return query;
    });

    const res = await GET(request);
    expect(res.status).toBe(200);
    expect(mockLogError).toHaveBeenCalledWith("cron.sync.prune.jobs", expect.any(Error));
    expect(mockLogError).toHaveBeenCalledWith("cron.sync.prune.counters", expect.any(Error));
  });

  it("reduces a non-Error raw string error to unknown_error", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "plaid_items") {
        data = [{ user_id: "u1" }];
      }
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data, error: null }).then(onfulfilled);
      return query;
    });

    mockSyncAllForUser.mockRejectedValue("Something failed");

    const res = await GET(request);
    expect(res.status).toBe(200);
    expect(mockAlertCronFailure).toHaveBeenCalledWith("daily-sync", {
      failed: 1,
      total: 1,
      firstError: "unknown_error",
    });
  });

  it("returns 401 if authorization header is missing", async () => {
    mockSafeEqual.mockReturnValue(false);
    const request = new NextRequest("http://localhost/api/cron/sync", {});
    const res = await GET(request);
    expect(res.status).toBe(401);
  });

  it("succeeds and returns 0 users if no plaid items exist", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation(() => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data: null, error: null }).then(onfulfilled);
      return query;
    });

    const res = await GET(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toBe(0);
  });

  it("does not send email if user has no email", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "plaid_items") {
        data = [{ user_id: "u1" }];
      } else if (table === "profiles") {
        const q = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { daily_digest_email_enabled: true }, error: null }),
        };
        return q;
      } else if (table === "notifications") {
        data = [{ type: "broken_bank", title: "b", body: "b" }];
      }

      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data, error: null }).then(onfulfilled);
      return query;
    });

    mockServiceClient.auth.admin.getUserById.mockResolvedValue({
      data: { user: { email: null } },
      error: null,
    });

    const res = await GET(request);
    expect(res.status).toBe(200);
    expect(mockSendDailyDigestEmail).not.toHaveBeenCalled();
  });
});
