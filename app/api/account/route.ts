import { NextResponse, type NextRequest } from "next/server";
import { getPlaidClient } from "@/lib/plaid";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { listActiveItems, decryptItemToken } from "@/lib/plaid-service";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";
import { logError } from "@/lib/log";
import { checkRateLimit } from "@/lib/rate-limit";
import { MAX_STEP_UP_ATTEMPTS_PER_HOUR, verifyStepUp } from "@/lib/step-up";

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
    MAX_STEP_UP_ATTEMPTS_PER_HOUR,
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
    let itemsRemoved = 0;
    let itemsFailed = 0;
    for (const item of items) {
      try {
        await plaid.itemRemove({ access_token: decryptItemToken(item) });
        itemsRemoved += 1;
      } catch (error) {
        itemsFailed += 1;
        logError("account.delete.itemRemove", error);
      }
    }

    // Clean user-owned Storage objects before deleting the Auth identity.
    // Supabase prevents deleting Auth users that own Storage objects.
    const service = createServiceClient();
    let storageRemoved = 0;
    if (service.storage?.from) {
      try {
        const avatarBucket = service.storage.from("avatars");
        if (avatarBucket?.list && avatarBucket?.remove) {
          const { data: avatarFiles } = await avatarBucket.list(user.id);
          if (avatarFiles && avatarFiles.length > 0) {
            const paths = avatarFiles.map((f: { name: string }) => `${user.id}/${f.name}`);
            const { error: removeErr } = await avatarBucket.remove(paths);
            if (!removeErr) storageRemoved += paths.length;
          }
        }
      } catch (err) {
        logError("account.delete.avatarCleanup", err);
      }

      try {
        const receiptBucket = service.storage.from("receipts");
        if (receiptBucket?.remove) {
          const { data: receiptRows } = await service
            .from("receipts")
            .select("storage_path")
            .eq("user_id", user.id);
          const paths = new Set<string>();
          if (Array.isArray(receiptRows)) {
            for (const row of receiptRows) {
              if (row.storage_path) paths.add(row.storage_path as string);
            }
          }
          if (receiptBucket?.list) {
            const { data: receiptFiles } = await receiptBucket.list(user.id);
            if (Array.isArray(receiptFiles)) {
              for (const f of receiptFiles) {
                paths.add(`${user.id}/${f.name}`);
              }
            }
          }
          if (paths.size > 0) {
            const { error: removeErr } = await receiptBucket.remove(Array.from(paths));
            if (!removeErr) storageRemoved += paths.size;
          }
        }
      } catch (err) {
        logError("account.delete.receiptCleanup", err);
      }
    }

    // Audit before deletion (audit_logs.user_id is ON DELETE SET NULL, so the
    // record survives the cascade).
    await writeAudit({
      userId: user.id,
      action: "account_delete",
      metadata: {
        items_removed: itemsRemoved,
        items_failed: itemsFailed,
        storage_objects_removed: storageRemoved,
      },
      ip: getClientIp(request),
    });

    // Deleting the auth user cascades to all user-owned rows.
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("account.delete", error);
  }
}
