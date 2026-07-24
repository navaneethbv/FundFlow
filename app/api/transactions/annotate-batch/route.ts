import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";

const MAX_BATCH = 100;

/**
 * Bulk tagging (8.5): add a tag to many transactions at once. Ownership is
 * proven with the RLS-bound client (only the caller's own ids resolve);
 * annotation upserts merge the new tag into any existing tags without
 * touching notes. Household-shared rows are visible but NOT taggable — the
 * ownership filter below keys on user_id.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as {
      transaction_ids?: unknown;
      tag?: string;
    } | null;
    const tag = body?.tag?.trim().toLowerCase();
    const ids = Array.isArray(body?.transaction_ids)
      ? body.transaction_ids.filter((id): id is string => typeof id === "string")
      : [];
    if (!tag || tag.length > 40) return badRequest("A tag (≤40 chars) is required");
    if (ids.length === 0 || ids.length > MAX_BATCH) {
      return badRequest(`Between 1 and ${MAX_BATCH} transaction ids required`);
    }

    // Ownership: only ids that are the caller's OWN rows survive this
    // filter (explicit user_id — shared household rows are excluded).
    const { data: owned } = await supabase
      .from("transactions")
      .select("id")
      .in("id", ids)
      .eq("user_id", user.id);
    const ownedIds = (owned ?? []).map((row) => row.id as string);
    if (ownedIds.length === 0) {
      return NextResponse.json({ updated: 0 });
    }

    const service = createServiceClient();
    const { data: existing } = await service
      .from("transaction_annotations")
      .select("transaction_id, note, tags")
      .eq("user_id", user.id)
      .in("transaction_id", ownedIds);
    const existingById = new Map(
      (existing ?? []).map((row) => [row.transaction_id as string, row]),
    );

    const upserts = ownedIds.map((transactionId) => {
      const current = existingById.get(transactionId);
      const tags = Array.from(
        new Set([...(((current?.tags as string[] | null) ?? [])), tag]),
      ).slice(0, 12);
      return {
        user_id: user.id,
        transaction_id: transactionId,
        note: (current?.note as string | null) ?? "",
        tags,
      };
    });
    const { error } = await service
      .from("transaction_annotations")
      .upsert(upserts, { onConflict: "user_id,transaction_id" });
    if (error) throw error;

    return NextResponse.json({ updated: upserts.length });
  } catch (error) {
    return errorResponse("transactions.annotate-batch", error);
  }
}
