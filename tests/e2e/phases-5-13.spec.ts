import { expect, test } from "@playwright/test";

/**
 * No-auth smoke tests for Phases 5–13 pages and APIs.
 * Verifies that routes exist and auth walls hold for unauthenticated visitors.
 */

// ---------- Phase 5: Recurring ----------
test("unauthenticated /recurring redirects to login", async ({ page }) => {
  await page.goto("/recurring");
  await expect(page).toHaveURL(/\/login/);
});

test("GET /api/recurring rejects unauthenticated callers", async ({ request }) => {
  const res = await request.get("/api/recurring");
  expect([401, 403]).toContain(res.status());
});

// ---------- Phase 6: Reports ----------
test("unauthenticated /reports redirects to login", async ({ page }) => {
  await page.goto("/reports");
  await expect(page).toHaveURL(/\/login/);
});

test("GET /api/reports/saved rejects unauthenticated callers", async ({ request }) => {
  const res = await request.get("/api/reports/saved");
  expect([401, 403]).toContain(res.status());
});

test("POST /api/reports/export/pdf rejects unauthenticated callers", async ({ request }) => {
  const res = await request.post("/api/reports/export/pdf", {
    data: { rows: [] },
  });
  expect([401, 403]).toContain(res.status());
});

// ---------- Phase 7: Goals ----------
test("unauthenticated /goals redirects to login", async ({ page }) => {
  await page.goto("/goals");
  await expect(page).toHaveURL(/\/login/);
});

// ---------- Phase 8: Investments ----------
test("unauthenticated /investments redirects to login", async ({ page }) => {
  await page.goto("/investments");
  await expect(page).toHaveURL(/\/login/);
});

test("GET /api/investments rejects unauthenticated callers", async ({ request }) => {
  const res = await request.get("/api/investments");
  expect([401, 403]).toContain(res.status());
});

// ---------- Phase 9: Forecasting ----------
test("unauthenticated /forecasting redirects to login", async ({ page }) => {
  await page.goto("/forecasting");
  await expect(page).toHaveURL(/\/login/);
});

test("POST /api/forecasting rejects unauthenticated callers", async ({ request }) => {
  const res = await request.post("/api/forecasting", {
    data: { startingBalance: 1000, asOf: "2024-01-01", horizonDays: 30, items: [], lowBalanceThreshold: 0 },
  });
  expect([401, 403]).toContain(res.status());
});

// ---------- Phase 10: Advice ----------
test("unauthenticated /advice redirects to login", async ({ page }) => {
  await page.goto("/advice");
  await expect(page).toHaveURL(/\/login/);
});

test("POST /api/advice rejects unauthenticated callers", async ({ request }) => {
  const res = await request.post("/api/advice", {
    data: { monthlyIncome: 5000, monthlySpend: 3000, savingsRate: 0.1, emergencyFundMonths: 3, debtToIncomeRatio: 0.2, goalCount: 1, hasInvestments: false },
  });
  expect([401, 403]).toContain(res.status());
});

// ---------- Phases 11-13: Settings ----------
test("unauthenticated /settings redirects to login", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login/);
});

test("GET /api/settings/feature-flags rejects unauthenticated callers", async ({ request }) => {
  const res = await request.get("/api/settings/feature-flags");
  expect([401, 403]).toContain(res.status());
});

test("GET /api/settings/preferences rejects unauthenticated callers", async ({ request }) => {
  const res = await request.get("/api/settings/preferences");
  expect([401, 403]).toContain(res.status());
});
