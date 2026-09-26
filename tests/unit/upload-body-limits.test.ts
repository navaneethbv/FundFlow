import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { from, service } = vi.hoisted(() => ({ from: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/http", async (original) => ({
  ...await original<typeof import("@/lib/http")>(),
  requireUser: () => ({ user: { id: "owner" }, supabase: { from } }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: service }));
import { POST as preview } from "@/app/api/import/preview/route";
import { POST as csv } from "@/app/api/import/csv/route";
import { POST as avatar } from "@/app/api/settings/profile/route";

beforeEach(() => vi.clearAllMocks());

describe("upload envelope limits", () => {
  it.each([
    ["import preview", preview, 3],
    ["CSV import", csv, 3],
    ["avatar", avatar, 4],
  ] as const)("rejects oversized %s before querying or writing user data", async (_name, handler, limitMiB) => {
    // No Content-Length: enforce bytes received, including ancillary fields.
    const request = new NextRequest("https://example.test/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: `--test\r\nContent-Disposition: form-data; name="padding"\r\n\r\n${"x".repeat(limitMiB * 1024 * 1024)}\r\n--test--\r\n`,
    });
    expect((await handler(request)).status).toBe(413);
    expect(from).not.toHaveBeenCalled();
    expect(service).not.toHaveBeenCalled();
  });
});
