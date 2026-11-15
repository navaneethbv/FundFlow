import type { SupabaseClient } from "@supabase/supabase-js";

/** Oldest maintenance attempt first, including manual-only and broken-bank users. */
export async function loadMaintenanceUsers(service: SupabaseClient, bankUsers: Set<string>): Promise<string[]> {
  const users = new Set<string>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await service.rpc("list_maintenance_users").range(offset, offset + 499);
    if (error) throw error;
    for (const row of data ?? []) users.add(row.user_id as string);
    if ((data ?? []).length < 500) break;
  }
  for (const userId of bankUsers) users.add(userId);
  return [...users];
}
