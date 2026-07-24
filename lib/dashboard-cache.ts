import type { SupabaseClient } from "@supabase/supabase-js";
import { getDashboardData, type DashboardData } from "@/lib/dashboard";

interface CacheRecord<T> {
  value: T;
  expiresAt: number;
}

export function createDashboardCache<T>(ttlMs: number) {
  const records = new Map<string, CacheRecord<T>>();

  function key(userId: string, scope: string) {
    return `${userId}:${scope}`;
  }

  return {
    async get(userId: string, scope: string): Promise<T | null> {
      const record = records.get(key(userId, scope));
      if (!record) return null;
      if (record.expiresAt <= Date.now()) {
        records.delete(key(userId, scope));
        return null;
      }
      return record.value;
    },
    async set(userId: string, scope: string, value: T): Promise<void> {
      records.set(key(userId, scope), {
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

import type { DashboardOptions } from "@/lib/dashboard";

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
  ].join(":");
}

export async function getCachedDashboardData(
  supabase: SupabaseClient,
  userId: string,
  selectedAccountId?: string,
  selectedMonth?: string,
  options?: DashboardOptions,
): Promise<DashboardData> {
  const scope = dashboardScopeKey(selectedAccountId, selectedMonth, options);
  const cached = await dashboardCache.get(userId, scope);
  if (cached) return cached;
  const data = await getDashboardData(supabase, selectedAccountId, selectedMonth, userId, options);
  await dashboardCache.set(userId, scope, data);
  return data;
}

/** Drop every cached scope for a user after their data changes (sync completion). */
export function invalidateDashboardCache(userId: string): void {
  dashboardCache.invalidateUser(userId);
}
