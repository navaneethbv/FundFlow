import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/import/preflight/route";
const state = vi.hoisted(() => ({ enabled: true, profiles: true, auth: vi.fn(), rate: vi.fn(), audit: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: (name: string) => name === "importPreflight" ? state.enabled : state.profiles }));
vi.mock("@/lib/http", async original => ({ ...await original<object>(), requireUser: () => state.auth() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...args: unknown[]) => state.rate(...args) }));
vi.mock("@/lib/audit", () => ({ writeAudit: (...args: unknown[]) => state.audit(...args), getClientIp: () => "127.0.0.1" }));
const text = 'Date,Description,Amount\n2026-01-01,Shop,1';
function request(content: string = text, fields: Record<string, string> = {}) {
  const form = new FormData(); form.set("file", new File([content], "bank.csv"));
  form.set("profile_id", "manual");
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new NextRequest("https://example.test/api/import/preflight", { method: "POST", body: form });
}
beforeEach(() => {
  vi.clearAllMocks(); state.enabled = true; state.profiles = true;
  state.auth.mockResolvedValue({ user: { id: "owner" }, supabase: { from: state.from } });
  state.rate.mockResolvedValue(true);
});
it.each(["importPreflight", "importProfiles"])("fails closed when %s is off", async name => {
  if (name === "importPreflight") state.enabled = false; else state.profiles = false;
  expect((await POST(request())).status).toBe(404);
  expect(state.rate).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
});
it("requires a cookie session and cannot use an export token", async () => {
  state.auth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  const req = request(); req.headers.set("authorization", "Bearer fft_export_only");
  expect((await POST(req)).status).toBe(401);
  expect(state.rate).not.toHaveBeenCalled();
});
it("rate limits before parsing", async () => {
  state.rate.mockResolvedValue(false);
  expect((await POST(request())).status).toBe(429);
  expect(state.rate).toHaveBeenCalledWith("import-preflight:owner", 30, 3600, { failClosed: true });
});
it("checks the file without staging financial rows and audits totals only", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ format: "csv", diagnostics: { canPreview: true, validRows: 1 } });
  expect(state.from).not.toHaveBeenCalled();
  expect(state.audit).toHaveBeenCalledWith({ userId: "owner", action: "import_preflight", ip: "127.0.0.1", metadata: { format: "csv", rows: 1, issues: 0 } });
});
it("returns row diagnostics and a mapping prompt without claiming any rows were staged", async () => {
  const response = await POST(request('When,What,Value\n2026-01-01,Shop,1'));
  expect(await response.json()).toMatchObject({ needs_mapping: true, headers: ["When", "What", "Value"], diagnostics: { canPreview: false } });
  expect(state.from).not.toHaveBeenCalled();
});
it("uses an explicit date choice to check a file accurately", async () => {
  const response = await POST(request('Date,Description,Amount\n31/01/2026,Shop,1', { date_order: "dmy" }));
  expect(await response.json()).toMatchObject({ diagnostics: { canPreview: true, validRows: 1 } });
});
it("leaves dedicated format validation in the existing preview", async () => {
  const response = await POST(request('<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>'));
  expect(await response.json()).toEqual({ format: "ofx", diagnostics: null });
});
it("rejects invalid forms, missing files, and oversized content", async () => {
  expect((await POST(new NextRequest('https://example.test', { method: "POST", body: 'bad' }))).status).toBe(400);
  expect((await POST(new NextRequest('https://example.test', { method: "POST", body: new FormData() }))).status).toBe(400);
  expect((await POST(request('x'.repeat(2 * 1024 * 1024 + 1)))).status).toBe(400);
});
it("propagates profile validation errors before analysis or audit", async () => {
  expect((await POST(request(text, { skip_rows: "-1" }))).status).toBe(400);
  expect(state.audit).not.toHaveBeenCalled();
});
it("handles operational failures", async () => {
  state.rate.mockRejectedValueOnce(new Error("offline"));
  expect((await POST(request())).status).toBe(500);
});

it("bounds the multipart body before parsing and rejects malformed column JSON", async () => {
  // Encode the multipart body ourselves to avoid the runtime's streaming File
  // serializer racing an intentional early body-limit abort.
  const body = '--fixture\r\nContent-Disposition: form-data; name="file"; filename="large.csv"\r\nContent-Type: text/csv\r\n\r\n' + 'x'.repeat(4 * 1024 * 1024) + '\r\n--fixture--';
  const oversized = new NextRequest("https://example.test/api/import/preflight", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=fixture" }, body });
  expect((await POST(oversized)).status).toBe(413);
  expect((await POST(request(text, { column_map: "{" }))).status).toBe(400);
});
