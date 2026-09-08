import type { SupabaseClient } from "@supabase/supabase-js";

/** Include manual-only users and users whose bank connections are broken. */
export async function loadMaintenanceUsers(service: SupabaseClient, bankUsers: Set<string>): Promise<string[]> {
  const users = new Set(bankUsers);
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await service.from("profiles").select("id").order("id").range(offset, offset + 499);
    if (error) throw error;
    for (const profile of data ?? []) users.add(profile.id as string);
    if ((data ?? []).length < 500) return [...users];
  }
}
