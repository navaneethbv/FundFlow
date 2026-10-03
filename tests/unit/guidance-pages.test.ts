import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ReactNode } from "react";
import { clientStub } from "../fixtures/supabase-query";
const mock = vi.hoisted(() => ({
  auth: vi.fn(),
  review: vi.fn(),
  connections: vi.fn(),
  payday: vi.fn(),
  dashboard: vi.fn(),
  planner: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("404");
  },
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/http", async (original) => ({
  ...(await original<object>()),
  requireUser: mock.auth,
}));
vi.mock("@/lib/balance-quality-data", () => ({
  loadBalanceReviews: mock.review,
}));
vi.mock("@/lib/connection-health-data", () => ({
  loadConnectionHealth: mock.connections,
}));
vi.mock("@/lib/payday-data", () => ({ loadPaydaySettings: mock.payday }));
vi.mock("@/lib/paycheck-planner-data", () => ({
  loadPaycheckPlan: mock.planner,
}));
vi.mock("@/lib/dashboard-cache", () => ({
  getCachedDashboardData: mock.dashboard,
}));
vi.mock("@/lib/report-period", () => ({
  resolveViewerToday: () => "2026-10-01",
}));
vi.mock("@/components/shell/AppShell", () => ({
  default: ({ children }: { children: ReactNode }) =>
    createElement("main", null, children),
}));
import BalancePage from "@/app/accounts/balance-review/page";
import ConnectionsPage from "@/app/settings/connections/page";
import PaydayPage from "@/app/settings/payday/page";
import PaychecksPage from "@/app/recurring/paychecks/page";
const pages = [
  () => BalancePage({ searchParams: Promise.resolve({}) }),
  ConnectionsPage,
  PaydayPage,
  PaychecksPage,
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv(
    "FUNDFLOW_FEATURE_FLAGS",
    "balanceQualityReview,connectionHealth,paydaySettings,paycheckPlanner",
  );
  mock.auth.mockResolvedValue({
    user: { id: "owner", email: "owner@example.invalid" },
    supabase: clientStub(),
  });
  mock.review.mockResolvedValue({ reviews: [], next: null });
  mock.connections.mockResolvedValue({ rows: [], manualAccounts: 0 });
  mock.payday.mockResolvedValue(null);
  mock.dashboard.mockResolvedValue({ insights: { paycheck: null } });
  mock.planner.mockResolvedValue({ configured: false });
});
afterEach(() => vi.unstubAllEnvs());
it.each(pages)(
  "returns 404 before reading any new table when its flag is off",
  async (page) => {
    vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "");
    await expect(page()).rejects.toThrow("404");
    expect(mock.auth).not.toHaveBeenCalled();
    for (const load of [
      mock.review,
      mock.connections,
      mock.payday,
      mock.planner,
    ])
      expect(load).not.toHaveBeenCalled();
  },
);
it.each(pages)("requires session authentication when enabled", async (page) => {
  mock.auth.mockResolvedValue(NextResponse.json({}, { status: 401 }));
  await expect(page()).rejects.toThrow("redirect:/login");
});
it("renders owner empty states and configuration prompts", async () => {
  expect(renderToStaticMarkup(await pages[0]!())).toContain(
    "No balance reviews",
  );
  expect(renderToStaticMarkup(await ConnectionsPage())).toContain(
    "No bank connections",
  );
  expect(renderToStaticMarkup(await PaydayPage())).toContain(
    "Confirm your payday",
  );
  expect(renderToStaticMarkup(await PaychecksPage())).toContain(
    "Confirm a payday and take-home amount",
  );
});
it("rejects an invalid review cursor without reading reviews", async () => {
  await expect(
    BalancePage({ searchParams: Promise.resolve({ before: "bad" }) }),
  ).rejects.toThrow("404");
  expect(mock.review).not.toHaveBeenCalled();
});
it("renders review navigation and uses owner-scoped account names", async () => {
  const db = clientStub({
    accounts: { data: [{ id: "account", name: "Checking" }] },
  });
  mock.auth.mockResolvedValue({ user: { id: "owner" }, supabase: db });
  mock.review.mockResolvedValue({
    reviews: [
      {
        id: "r",
        version: "v",
        account_id: "account",
        snapshot_date: "2026-10-01",
        raw_balance: null,
        anchor_balance: null,
        anchor_date: null,
        currency: "USD",
        reasons: ["missing_balance"],
        decision: "pending",
        superseded_at: null,
      },
    ],
    next: "next",
  });
  const html = renderToStaticMarkup(
    await BalancePage({
      searchParams: Promise.resolve({
        before: "00000000-0000-0000-0000-000000000001",
      }),
    }),
  );
  expect(html).toContain("Checking");
  expect(html).toContain("First page");
  expect(html).toContain("More reviews");
  expect(db.scopedToUser("accounts", "owner")).toBe(true);
});
it("keeps unsupported currencies separate and renders configured periods", async () => {
  mock.planner.mockResolvedValueOnce({
    configured: true,
    currencyUnsupported: true,
  });
  expect(renderToStaticMarkup(await PaychecksPage())).toContain(
    "Mixed currencies are not combined",
  );
  mock.planner.mockResolvedValueOnce({
    configured: true,
    currencyUnsupported: false,
    periods: [],
    cash: 0,
  });
  expect(renderToStaticMarkup(await PaychecksPage())).toContain("Cash on hand");
});
