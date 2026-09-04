import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persistAccountPreferences } from "@/lib/account-preferences";

function makeClient(options?: {
  user?: { id: string } | null;
  authError?: Error | null;
  rpcError?: Error | null;
}) {
  const rpc = vi.fn().mockResolvedValue({ error: options?.rpcError ?? null });
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options?.user === undefined ? { id: "user-1" } : options.user },
        error: options?.authError ?? null,
      }),
    },
    rpc,
  } as unknown as SupabaseClient;

  return { client, rpc };
}

describe("persistAccountPreferences", () => {
  it("updates the accounts page through the atomic RPC", async () => {
    const { client, rpc } = makeClient();
    const prefs = { hiddenIds: ["account-2"], order: ["account-2", "account-1"] };

    await expect(persistAccountPreferences(client, prefs)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("update_account_preferences", {
      p_accounts_page: prefs,
    });
  });

  it("surfaces authentication failures", async () => {
    const authError = new Error("auth unavailable");
    const { client } = makeClient({ authError });

    await expect(persistAccountPreferences(client, {})).rejects.toBe(authError);
  });

  it("requires a signed-in user", async () => {
    const { client } = makeClient({ user: null });

    await expect(persistAccountPreferences(client, {})).rejects.toThrow(
      "Sign in again to save account preferences.",
    );
  });

  it("surfaces RPC failures", async () => {
    const rpcError = new Error("RPC unavailable");
    const { client } = makeClient({ rpcError });

    await expect(persistAccountPreferences(client, {})).rejects.toBe(rpcError);
  });
});
