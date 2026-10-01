import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const requireUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http", () => ({ requireUser, errorResponse: vi.fn() }));
import { GET, POST } from "@/app/api/household/accept/route";
it("GET only opens confirmation and never authenticates or writes membership", async () => {
  const result = await GET(new NextRequest("https://app.test/api/household/accept?token=abc"));
  expect(result.headers.get("location")).toBe("https://app.test/household/accept?token=abc");
  expect(requireUser).not.toHaveBeenCalled();
});
it.each([null, "https://evil.test"])("rejects unconfirmed cross-origin POST with origin %s", async (origin) => {
  const headers = origin ? { origin } : undefined;
  expect((await POST(new NextRequest("https://app.test/api/household/accept", { method: "POST", headers }))).status).toBe(403);
  expect(requireUser).not.toHaveBeenCalled();
});
