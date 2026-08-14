import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/health/route";

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: mockFrom,
  }),
}));

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 and healthy status when database is reachable", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { updated_at: twoHoursAgo },
                error: null,
              }),
            }),
          }),
        }),
      }),
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.db).toBe(true);
    expect(json.status).toBe("healthy");
    expect(json.degraded).toBe(false);
    expect(json.lastSyncAgeHours).toBe(2);
    expect(typeof json.responseMs).toBe("number");
    expect(json.checks.database.status).toBe("connected");
  });

  it("flags degraded when last sync is older than 48 hours", async () => {
    const sixtyHoursAgo = new Date(Date.now() - 60 * 3600000).toISOString();
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { updated_at: sixtyHoursAgo },
                error: null,
              }),
            }),
          }),
        }),
      }),
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.db).toBe(true);
    expect(json.status).toBe("degraded");
    expect(json.degraded).toBe(true);
    expect(json.lastSyncAgeHours).toBe(60);
  });

  it("returns 503 when database query fails", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "database offline" },
              }),
            }),
          }),
        }),
      }),
    });

    const response = await GET();
    expect(response.status).toBe(503);

    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.db).toBe(false);
  });
});
