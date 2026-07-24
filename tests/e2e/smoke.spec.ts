import { expect, test } from "@playwright/test";

/**
 * No-auth smoke suite: safe to run against any deployment (local dev,
 * preview, or production). Verifies routing, the login surface, security
 * headers from proxy.ts, and that auth walls actually hold.
 *
 * Authenticated golden-path specs (Plaid sandbox) are tracked in README.md.
 */

test("root redirects a signed-out visitor to the login page", async ({ page }) => {
  const response = await page.goto("/");
  expect(response, "navigation should produce a response").toBeTruthy();
  expect(response!.status(), "final response should be OK").toBeLessThan(400);
  await expect(page).toHaveURL(/\/login/);
});

test("login page renders the sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Welcome back")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("responses carry the security headers from proxy.ts", async ({ page }) => {
  const response = await page.goto("/login");
  const headers = response!.headers();

  const csp = headers["content-security-policy"];
  expect(csp, "CSP header must be present").toBeTruthy();
  expect(csp).toContain("strict-dynamic");
  expect(csp).toMatch(/'nonce-[^']+'/);

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBeTruthy();
});

test("unauthenticated dashboard visit redirects to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("mutating API rejects unauthenticated callers", async ({ request }) => {
  const response = await request.post("/api/plaid/sync", {
    data: { source: "e2e-smoke" },
  });
  expect([401, 403]).toContain(response.status());
});

test("privacy-safe export is not publicly accessible", async ({ request }) => {
  const response = await request.get("/api/export/csv");
  expect([401, 403]).toContain(response.status());
});
