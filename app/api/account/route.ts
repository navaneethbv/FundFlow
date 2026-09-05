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
async function removeUserPlaidItems(userId: string): Promise<{ removed: number; failed: number }> {
  const items = await listActiveItems(userId);
  const plaid = getPlaidClient();
  let removed = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await plaid.itemRemove({ access_token: decryptItemToken(item) });
      removed += 1;
    } catch (error) {
      failed += 1;
      logError("account.delete.itemRemove", error);
    }
  }
  return { removed, failed };
}

async function listAllBucketFiles(
  bucket: {
    list: (
      path?: string,
      options?: { limit?: number; offset?: number },
    ) => Promise<{ data: Array<{ name: string }> | null; error?: unknown }>;
  },
  folder: string,
): Promise<Array<{ name: string }>> {
  const files: Array<{ name: string }> = [];
  const limit = 1000;
  let offset = 0;
  while (true) {
    const { data } = await bucket.list(folder, { limit, offset });
    const batch = data ?? [];
    if (batch.length === 0) break;
    files.push(...batch);
    if (batch.length < limit) break;
    offset += batch.length;
  }
  return files;
}

async function removeBucketPaths(
  bucket: { remove: (paths: string[]) => Promise<{ error: unknown }> },
  paths: string[],
): Promise<number> {
  let removedCount = 0;
  for (let i = 0; i < paths.length; i += 1000) {
    const chunk = paths.slice(i, i + 1000);
    const { error } = await bucket.remove(chunk);
    if (!error) removedCount += chunk.length;
  }
  return removedCount;
}

async function cleanupAvatarStorage(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<number> {
  try {
    const avatarBucket = service.storage.from("avatars");
    if (!avatarBucket?.list || !avatarBucket?.remove) return 0;
    const avatarFiles = await listAllBucketFiles(avatarBucket, userId);
    if (avatarFiles.length === 0) return 0;
    const paths = avatarFiles.map((f: { name: string }) => `${userId}/${f.name}`);
    return await removeBucketPaths(avatarBucket, paths);
  } catch (err) {
    logError("account.delete.avatarCleanup", err);
    return 0;
  }
}

function collectReceiptPaths(
  receiptRows: unknown,
  receiptFiles: unknown,
  userId: string,
): string[] {
  const paths = new Set<string>();
  if (Array.isArray(receiptRows)) {
    for (const row of receiptRows) {
      if (row?.storage_path && typeof row.storage_path === "string") {
        paths.add(row.storage_path);
      }
    }
  }
  if (Array.isArray(receiptFiles)) {
    for (const f of receiptFiles) {
      if (f?.name && typeof f.name === "string") {
        paths.add(`${userId}/${f.name}`);
      }
    }
  }
  return Array.from(paths);
}

async function cleanupReceiptStorage(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<number> {
  try {
    const receiptBucket = service.storage.from("receipts");
    if (!receiptBucket?.list || !receiptBucket?.remove) return 0;
    const { data: receiptRows } = await service
      .from("receipts")
      .select("storage_path")
      .eq("user_id", userId);
    const receiptFiles = await listAllBucketFiles(receiptBucket, userId);
    const paths = collectReceiptPaths(receiptRows, receiptFiles, userId);
    if (paths.length === 0) return 0;
    return await removeBucketPaths(receiptBucket, paths);
  } catch (err) {
    logError("account.delete.receiptCleanup", err);
    return 0;
  }
}

async function cleanupUserStorageObjects(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<number> {
  if (!service.storage?.from) return 0;
  const avatars = await cleanupAvatarStorage(service, userId);
  const receipts = await cleanupReceiptStorage(service, userId);
  return avatars + receipts;
}

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

    const { removed: itemsRemoved, failed: itemsFailed } = await removeUserPlaidItems(user.id);
    const service = createServiceClient();
    const storageRemoved = await cleanupUserStorageObjects(service, user.id);

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
