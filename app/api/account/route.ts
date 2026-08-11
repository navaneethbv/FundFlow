import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getPlaidClient } from "@/lib/plaid";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { listActiveItems, decryptItemToken } from "@/lib/plaid-service";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";
import { logError } from "@/lib/log";
import { checkRateLimit } from "@/lib/rate-limit";

/** Cap on step-up attempts per hour, so a stolen session can't hammer the
 *  password/code check (and so a brute-force attempt is throttled). */
const MAX_ATTEMPTS_PER_HOUR = 5;

/**
 * Verify a re-authentication step-up before a destructive action.
 *
 * Which proof is acceptable is decided here, from the factors the user has
 * actually enrolled, so the caller cannot pick the weaker one: a user with a
 * verified TOTP factor must produce a fresh code, and only a user without one
 * falls back to their password.
 */
async function verifyStepUp(
  supabase: SupabaseClient,
  user: User,
  code: string,
): Promise<boolean> {
  const { data } = await supabase.auth.mfa.listFactors();
  const factors = (data?.totp ?? []).filter(
    (factor) => factor.status === "verified",
  );

  if (factors.length > 0) {
    for (const factor of factors) {
      try {
        const { error } = await supabase.auth.mfa.challengeAndVerify({
          factorId: factor.id,
          code,
        });
        if (!error) return true;
      } catch {
        // Wrong code for this factor; try the next verified factor.
      }
    }
    return false;
  }

  if (!user.email) return false;
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: code,
  });
  return !error;
}

/**
 * User-controlled account deletion. Removes all Plaid items at Plaid, then
 * deletes the auth user, which cascades to profiles and every user-owned table.
 *
 * ADDING A USER-OWNED TABLE? This route needs no edit, but the new table only
 * gets erased if its owner column is declared
 * `user_id uuid not null references auth.users (id) on delete cascade`.
 * A table that references profiles, or omits the cascade, silently survives
 * account deletion. Sibling checklists: app/api/export/takeout/route.ts and
 * app/api/cron/backup/route.ts. Account balance snapshots cascade through
 * user_id and through both account_id and manual_account_id source records.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  const allowed = await checkRateLimit(
    `account-delete:${user.id}`,
    MAX_ATTEMPTS_PER_HOUR,
    3600,
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a while." },
      { status: 429 },
    );
  }

  try {
    // Re-authentication step-up: a stolen session alone must never be able to
    // permanently destroy the account. MFA users confirm with a fresh TOTP
    // code; everyone else re-enters their password. The required method is
    // decided here from the user's enrolled factors, never from the request
    // body; otherwise an attacker holding a stolen session could downgrade an
    // MFA-protected account to a password-only confirmation.
    const body = await request.json().catch(() => null);
    const code = body?.code as unknown;
    if (typeof code !== "string" || code.length === 0) {
      return badRequest("A verification code is required.");
    }
    const stepUpOk = await verifyStepUp(supabase, user, code);
    if (!stepUpOk) {
      await writeAudit({
        userId: user.id,
        action: "account_delete_failed",
        metadata: { reason: "step_up_failed" },
        ip: getClientIp(request),
      });
      return NextResponse.json(
        { error: "Verification failed. Try again." },
        { status: 401 },
      );
    }

    // Remove each bank connection at Plaid first (best effort).
    const items = await listActiveItems(user.id);
    const plaid = getPlaidClient();
    for (const item of items) {
      try {
        await plaid.itemRemove({ access_token: decryptItemToken(item) });
      } catch (error) {
        logError("account.delete.itemRemove", error);
      }
    }

    // Audit before deletion (audit_logs.user_id is ON DELETE SET NULL, so the
    // record survives the cascade).
    await writeAudit({
      userId: user.id,
      action: "account_delete",
      metadata: { items_removed: items.length },
      ip: getClientIp(request),
    });

    // Deleting the auth user cascades to all user-owned rows.
    const service = createServiceClient();
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("account.delete", error);
  }
}
