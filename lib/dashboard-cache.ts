import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getDashboardData,
  type DashboardData,
  type DashboardOptions,
} from "@/lib/dashboard";
import { resolveViewerToday } from "@/lib/report-period";

interface CacheRecord<T> {
  value: T;
  expiresAt: number;
}

function cacheKeyFor(userId: string, scope: string) {
  return `${userId}:${scope}`;
}

export function createDashboardCache<T>(ttlMs: number) {
  const records = new Map<string, CacheRecord<T>>();

  return {
    async get(userId: string, scope: string): Promise<T | null> {
      const record = records.get(cacheKeyFor(userId, scope));
      if (!record) return null;
      if (record.expiresAt <= Date.now()) {
        records.delete(cacheKeyFor(userId, scope));
        return null;
      }
      return record.value;
    },
    async set(userId: string, scope: string, value: T): Promise<void> {
      records.set(cacheKeyFor(userId, scope), {
        value,
        expiresAt: Date.now() + ttlMs,
      });
    },
    invalidateUser(userId: string): void {
      for (const cacheKey of records.keys()) {
        if (cacheKey.startsWith(`${userId}:`)) records.delete(cacheKey);
      }
    },
  };
}

// Process-local dashboard cache. Keyed strictly by user id + render scope, so a
// warm serverless instance skips recomputing the full aggregation on the
// 2-minute AutoRefresh re-render. The TTL is short because budgets and goals are
// written straight from the browser (no server route to invalidate on); sync
// completion invalidates explicitly. Only ever populated with a user-scoped
// (RLS-bound) client, so one user's cache can never be served to another.
const DASHBOARD_TTL_MS = 45_000;
const dashboardCache = createDashboardCache<DashboardData>(DASHBOARD_TTL_MS);

export function dashboardScopeKey(
  selectedAccountId?: string,
  selectedMonth?: string,
  options?: DashboardOptions,
): string {
  return [
    selectedAccountId ?? "all",
    selectedMonth ?? "default",
    options?.itemId ?? "all",
    options?.drill?.category ?? "-",
    options?.drill?.sub ?? "-",
    options?.drill?.merchant ?? "-",
    options?.scope ?? "mine",
    options?.includeBalanceSheet === false ? "no-bs" : "bs",
    // The open month derives from the viewer's day (M-11): without this, a
    // cached load from before a month boundary serves the wrong "current".
    options?.today ?? "server-day",
  ].join(":");
}

export async function getCachedDashboardData(
  supabase: SupabaseClient,
  userId: string,
  selectedAccountId?: string,
  selectedMonth?: string,
  options?: DashboardOptions,
): Promise<DashboardData> {
  // The viewer's day drives the open month (M-11). Resolve it before the
  // scope key so a cached load from before a month boundary cannot serve
  // the wrong "current".
  const today = options?.today ?? (await resolveViewerToday(supabase, userId));
  const datedOptions = { ...options, today };
  const scope = dashboardScopeKey(selectedAccountId, selectedMonth, datedOptions);
  const cached = await dashboardCache.get(userId, scope);
  if (cached) return cached;
  const data = await getDashboardData(supabase, selectedAccountId, selectedMonth, userId, datedOptions);
  await dashboardCache.set(userId, scope, data);
  return data;
}

/** Drop every cached scope for a user after their data changes (sync completion). */
export function invalidateDashboardCache(userId: string): void {
  dashboardCache.invalidateUser(userId);
}
