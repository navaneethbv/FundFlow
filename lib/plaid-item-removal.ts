import "server-only";
import { getPlaidClient } from "@/lib/plaid";
import { decryptItemToken } from "@/lib/plaid-service";
import type { PlaidItemRow } from "@/lib/types";

export async function removeItemAtPlaid(item: PlaidItemRow): Promise<void> {
  try {
    await getPlaidClient().itemRemove({ access_token: decryptItemToken(item) });
  } catch (error) {
    const details = error as { response?: { data?: { error_code?: unknown } }; error_code?: unknown; message?: unknown };
    const code = details?.response?.data?.error_code ?? details?.error_code;
    const removed = code === "ITEM_NOT_FOUND" || code === "INVALID_ACCESS_TOKEN" ||
      (typeof details?.message === "string" && /\b(?:ITEM_NOT_FOUND|INVALID_ACCESS_TOKEN)\b/.test(details.message));
    if (!removed) throw error;
  }
}
