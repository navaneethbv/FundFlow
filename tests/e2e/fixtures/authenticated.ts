import { test as base, expect, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FinanceSeed } from "./seed";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

export const hasLiveCredentials = Boolean(url && publishableKey && secretKey);

export interface UserAccount {
  id: string;
  email: string;
  password: string;
  stamp: string;
}

interface AuthenticatedFixtures {
  admin: SupabaseClient;
  account: UserAccount;
  authenticatedPage: Page;
  seed: FinanceSeed;
}

export const test = base.extend<AuthenticatedFixtures>({
  admin: async ({}, provide) => {
    if (!hasLiveCredentials) throw new Error("Live Supabase credentials are required");
    const admin = createClient(url!, secretKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await provide(admin);
  },
  account: async ({ admin }, provide, testInfo) => {
    const stamp = `${Date.now()}-${testInfo.workerIndex}-${testInfo.retry}`;
    const email = `quality-e2e-${stamp}@example.com`;
    const password = "Quality-E2E-Password-123!";
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    await provide({ id: data.user.id, email, password, stamp });
    await admin.auth.admin.deleteUser(data.user.id);
  },
  authenticatedPage: async ({ page, account }, provide) => {
    await signIn(page, account);
    await provide(page);
  },
  seed: async ({ admin, account }, provide) => {
    await provide(new FinanceSeed(admin, account.id, account.stamp));
  },
});

export async function signIn(page: Page, account: UserAccount): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-08-09T17:00:00Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(account.email);
  await page.getByPlaceholder("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

export { expect };
