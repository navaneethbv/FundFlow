import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { importHistoryPage, loadImportHistory, type ImportHistoryBatch } from "@/lib/import-history";
import ImportHistory from "@/components/settings/ImportHistory";
const state = vi.hoisted(() => ({ enabled: false, auth: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => state.enabled }));
vi.mock("@/lib/http", () => ({ requireUser: () => state.auth() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); } }));
vi.mock("@/components/shell/AppShell", () => ({ default: ({ children }: { children: unknown }) => children }));
import Page from "@/app/settings/import-history/page";

function query(data: unknown, error: unknown = null) {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), order: vi.fn(() => q), range: vi.fn(async () => ({ data, error })) };
  return { q, client: { from: vi.fn(() => q) } as unknown as SupabaseClient };
}
beforeEach(() => { vi.clearAllMocks(); state.enabled = false; });
it.each([undefined, "0", "-1", "1.5", "Infinity", "10001", "junk"])("normalizes invalid page %s", value => {
  expect(importHistoryPage(value)).toBe(1);
});
it("accepts bounded integer pages", () => { expect(importHistoryPage("2")).toBe(2); });
it("reads only committed owner batches, with stable bounded pagination", async () => {
  const rows = Array.from({ length: 26 }, (_, i) => ({ id: String(i) }));
  const { q, client } = query(rows);
  expect(await loadImportHistory(client, "owner", 2)).toEqual({ batches: rows.slice(0, 25), hasNext: true });
  expect(q.eq.mock.calls).toEqual([["user_id", "owner"], ["status", "committed"]]);
  expect(q.order.mock.calls).toEqual([["created_at", { ascending: false }], ["id", { ascending: false }]]);
  expect(q.range).toHaveBeenCalledWith(25, 50);
});
it("returns empty history and surfaces failed reads", async () => {
  expect(await loadImportHistory(query(null).client, "owner", 1)).toEqual({ batches: [], hasNext: false });
  await expect(loadImportHistory(query(null, new Error("offline")).client, "owner", 1)).rejects.toThrow("offline");
});
it("returns 404 without history reads when off", async () => {
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("404");
  expect(state.auth).not.toHaveBeenCalled();
});
it("does not read history without an authenticated MFA session", async () => {
  state.enabled = true;
  state.auth.mockResolvedValue(NextResponse.json({}, { status: 401 }));
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("404");
});
it.each([1, 2])("renders working navigation for page %s", async page => {
  state.enabled = true;
  state.auth.mockResolvedValue({ user: { id: "owner", email: "owner@example.invalid" }, supabase: query([]).client });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ page: String(page) }) }));
  expect(html).toContain("Import a file");
  expect(html.includes("Previous page")).toBe(page > 1);
  expect(html).not.toContain("Next page");
});
it("shows a next page when another batch exists", async () => {
  state.enabled = true;
  const rows = Array.from({ length: 26 }, (_, id) => ({ id: String(id), file_name: "bank.csv", created_at: "2026-10-01T00:00:00Z", history_summary: null }));
  state.auth.mockResolvedValue({ user: { id: "owner" }, supabase: query(rows).client });
  expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))).toContain("Next page");
});
it("preserves unknown legacy values and separates flagged, imported, skipped counts", () => {
  const legacy: ImportHistoryBatch = { id: "old", file_name: "<bank>.csv", created_at: "2026-10-01T00:00:00Z", history_profile_name: null, history_summary: null };
  const current: ImportHistoryBatch = { ...legacy, id: "new", history_profile_name: "Bank", history_summary: {
    imported: 2, skipped: 1, flagged: 2, unknownTargets: 1, committedAt: "2026-10-01T12:00:00Z", committedBy: "owner", targets: [{ manual_account_id: "cash", name: "Wallet" }, { account_id: "bank", name: "Checking" }],
  } };
  const html = renderToStaticMarkup(createElement(ImportHistory, { batches: [legacy, current] }));
  expect(html).toContain("Not recorded");
  expect(html).toContain("&lt;bank&gt;.csv");
  expect(html).toContain("Wallet");
  expect(html).toContain("Checking");
  expect(html).toContain("updates to existing transactions");
  expect(html).toContain("UTC");
  expect(html).not.toContain("Delete");
});
