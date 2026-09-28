import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getDashboardData,
  type DashboardData,
  type DashboardOptions,
} from "@/lib/dashboard";
import { resolveViewerToday } from "@/lib/report-period";

interface CacheRecord<T> {
  userId: string;
  value: T;
  expiresAt: number;
}

function cacheKeyFor(userId: string, scope: string) {
  return JSON.stringify([userId, scope]);
}

// A fixed entry ceiling bounds retention even when every request uses a new filter.
const MAX_DASHBOARD_SCOPES = 32;

export function createDashboardCache<T>(ttlMs: number) {
  const records = new Map<string, CacheRecord<T>>();

  function pruneExpired() {
    const now = Date.now();
    for (const [key, record] of records) {
      if (record.expiresAt <= now) records.delete(key);
    }
  }

  return {
    async get(userId: string, scope: string): Promise<T | null> {
      pruneExpired();
      const key = cacheKeyFor(userId, scope);
      const record = records.get(key);
      if (!record) return null;
      // Map insertion order tracks recency without a second collection.
      records.delete(key);
      records.set(key, record);
      return record.value;
    },
    async set(userId: string, scope: string, value: T): Promise<void> {
      pruneExpired();
      const key = cacheKeyFor(userId, scope);
      records.delete(key);
      if (records.size >= MAX_DASHBOARD_SCOPES) {
        records.delete(records.keys().next().value!);
      }
      records.set(key, { userId, value, expiresAt: Date.now() + ttlMs });
    },
    invalidateUser(userId: string): void {
      for (const [key, record] of records) {
        if (record.userId === userId) records.delete(key);
      }
    },
  };
}

// Process-local dashboard cache. Keyed strictly by user id + render scope, so a
// warm serverless instance can reuse aggregation during rapid revisits. The
// 45-second TTL expires before the normal 2-minute AutoRefresh. Budgets and goals are
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
  return JSON.stringify([
    selectedAccountId ?? null,
    selectedMonth ?? null,
    options?.itemId ?? null,
    options?.drill?.category ?? null,
    options?.drill?.sub ?? null,
    options?.drill?.merchant ?? null,
    options?.scope ?? "mine",
    options?.includeBalanceSheet === false ? "no-bs" : "bs",
    // The open month derives from the viewer's day (M-11): without this, a
    // cached load from before a month boundary serves the wrong "current".
    options?.today ?? "server-day",
  ]);
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
