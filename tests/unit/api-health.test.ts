import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

let service = clientStub();
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => service }));
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  let tick = 0;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2030, 0, 1) + tick++ * 60_000));
    service = clientStub();
  });
  afterEach(() => vi.useRealTimers());

  it("reports database and sync health and caches concurrent and repeated polls", async () => {
    service = clientStub({ sync_jobs: { data: { updated_at: new Date(Date.now() - 2 * 3600_000).toISOString() } } });
    const responses = await Promise.all([GET(), GET(), GET()]);
    expect(responses[0].status).toBe(200);
    await expect(responses[0].json()).resolves.toMatchObject({
      ok: true, db: true, status: "healthy", degraded: false, lastSyncAgeHours: 2,
      checks: { database: { status: "connected" } },
    });
    await GET();
    expect(service.from).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(30_000);
    await GET();
    expect(service.from).toHaveBeenCalledTimes(4);
  });

  it("flags stale scheduled workflows without exposing delivery rows", async () => {
    service = clientStub({
      cron_delivery_windows: { data: [{ delivery_key: "scheduler:weekly-report", sent_through: new Date(Date.now() - 28 * 3600_000).toISOString() }] },
    });
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      degraded: true,
      checks: { scheduler: {
        "weekly-report": { status: "stale", ageHours: 28 },
        backup: { status: "unknown", ageHours: null },
      } },
    });
  });

  it("flags a sync older than 48 hours", async () => {
    service = clientStub({ sync_jobs: { data: { updated_at: new Date(Date.now() - 60 * 3600_000).toISOString() } } });
    await expect((await GET()).json()).resolves.toMatchObject({ degraded: true, lastSyncAgeHours: 60 });
  });

  it("returns 503 when the database query fails", async () => {
    service = clientStub({ sync_jobs: { error: { message: "database offline" } } });
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, db: false });
  });
});
