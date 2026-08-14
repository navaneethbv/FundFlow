import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { validateSplits } from "@/lib/transaction-quality";
import { writeAudit, getClientIp } from "@/lib/audit";

interface SplitInput {
  category: string;
  amount: number;
}

type LinkedGoal = { id: string; spending_reduces: boolean };

async function resolveGoal(
  supabase: Awaited<ReturnType<typeof requireUser>> extends infer Auth
    ? Auth extends { supabase: infer Client }
      ? Client
      : never
    : never,
  userId: string,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; goalProvided: boolean; goalId: string | null; linkedGoal: LinkedGoal | null }
  | { ok: false; response: NextResponse }
> {
  const goalProvided = body.goal_id !== undefined;
  const goalId =
    typeof body.goal_id === "string" && body.goal_id.trim()
      ? body.goal_id.trim()
      : null;
  if (!goalProvided || !goalId) return { ok: true, goalProvided, goalId, linkedGoal: null };
  const { data: goal } = await supabase
    .from("goals")
    .select("id, spending_reduces")
    .eq("id", goalId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!goal) return { ok: false, response: badRequest("Goal not found") };
  return { ok: true, goalProvided, goalId, linkedGoal: goal as LinkedGoal };
}

async function saveAnnotation(
  supabase: Awaited<ReturnType<typeof requireUser>> extends infer Auth
    ? Auth extends { supabase: infer Client }
      ? Client
      : never
    : never,
  userId: string,
  transactionId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const rawNote = typeof body.note === "string" ? body.note.trim() : "";
  const note = rawNote.length ? rawNote.slice(0, 500) : null;
  const tags = Array.isArray(body.tags)
    ? [
        ...new Set(
          (body.tags as unknown[])
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0 && tag.length <= 40),
        ),
      ].slice(0, 20)
    : [];
  const goalProvided = body.goal_id !== undefined;
  const goalId =
    typeof body.goal_id === "string" && body.goal_id.trim()
      ? body.goal_id.trim()
      : null;
  const keepsGoalLink = goalProvided && goalId !== null;
  if (!note && tags.length === 0 && !keepsGoalLink) {
    const { error } = await supabase
      .from("transaction_annotations")
      .delete()
      .eq("user_id", userId)
      .eq("transaction_id", transactionId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("transaction_annotations").upsert(
    {
      user_id: userId,
      transaction_id: transactionId,
      note,
      tags,
      ...(goalProvided ? { goal_id: goalId } : {}),
    },
    { onConflict: "user_id,transaction_id" },
  );
  if (error) throw error;
}

async function saveSplits(
  supabase: Awaited<ReturnType<typeof requireUser>> extends infer Auth
    ? Auth extends { supabase: infer Client }
      ? Client
      : never
    : never,
  userId: string,
  transactionId: string,
  absAmount: number,
  value: unknown,
): Promise<NextResponse | null> {
  const rawSplits = Array.isArray(value) ? value : [];
  const splits: SplitInput[] = rawSplits
    .map((candidate: unknown) => {
      const row = candidate as { category?: unknown; amount?: unknown };
      return {
        category: typeof row.category === "string" ? row.category.trim() : "",
        amount: Math.round(Number(row.amount) * 100) / 100,
      };
    })
    .filter(
      (split: SplitInput) =>
        split.category.length > 0 &&
        Number.isFinite(split.amount) &&
        split.amount > 0,
    );
  if (splits.length === 0) {
    const { error } = await supabase
      .from("transaction_splits")
      .delete()
      .eq("user_id", userId)
      .eq("transaction_id", transactionId);
    if (error) throw error;
    return null;
  }
  const check = validateSplits(
    { id: transactionId, amount: absAmount, category: null },
    splits.map((split) => ({
      transactionId,
      category: split.category,
      amount: split.amount,
    })),
  );
  if (!check.valid) {
    return badRequest(
      `Splits must total ${absAmount.toFixed(2)} (off by ${check.difference.toFixed(2)}).`,
    );
  }
  const { error: deleteError } = await supabase
    .from("transaction_splits")
    .delete()
    .eq("user_id", userId)
    .eq("transaction_id", transactionId);
  if (deleteError) throw deleteError;
  const { error: insertError } = await supabase.from("transaction_splits").insert(
    splits.map((split) => ({
      user_id: userId,
      transaction_id: transactionId,
      category: split.category,
      amount: split.amount,
    })),
  );
  if (insertError) throw insertError;
  return null;
}

async function saveGoalProgress(
  supabase: Awaited<ReturnType<typeof requireUser>> extends infer Auth
    ? Auth extends { supabase: infer Client }
      ? Client
      : never
    : never,
  userId: string,
  transactionId: string,
  transaction: { amount: number | string; date: string },
  goalProvided: boolean,
  goalId: string | null,
  linkedGoal: LinkedGoal | null,
  request: NextRequest,
): Promise<void> {
  if (!goalProvided) return;
  let stale = supabase
    .from("goal_progress_events")
    .delete()
    .eq("user_id", userId)
    .eq("transaction_id", transactionId);
  if (goalId) stale = stale.neq("goal_id", goalId);
  const { error: staleError } = await stale;
  if (staleError) throw staleError;
  const isExpense = Number(transaction.amount) > 0;
  if (linkedGoal?.spending_reduces && isExpense) {
    const { error } = await supabase.from("goal_progress_events").upsert(
      {
        user_id: userId,
        goal_id: linkedGoal.id,
        transaction_id: transactionId,
        event_date: transaction.date,
        amount: -Math.abs(Number(transaction.amount)),
        event_type: "transaction",
      },
      { onConflict: "goal_id,transaction_id" },
    );
    if (error) throw error;
  } else if (goalId) {
    const { error } = await supabase
      .from("goal_progress_events")
      .delete()
      .eq("user_id", userId)
      .eq("transaction_id", transactionId)
      .eq("goal_id", goalId);
    if (error) throw error;
  }
  await writeAudit({
    userId,
    action: "goal_transaction_linked",
    metadata: { transaction_id: transactionId, goal_id: goalId },
    ip: getClientIp(request),
  });
}

/**
 * Save user annotations (note + tags) and category splits for one transaction.
 * Annotations sit alongside the immutable Plaid-synced row; splits, when they
 * sum to the transaction amount, redistribute its spend across categories in
 * dashboard aggregation. The whole payload is replace-semantics: empty note and
 * tags removes the annotation; empty/absent splits removes any splits.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = await request.json().catch(() => null);
    const transactionId = body?.transaction_id;
    if (typeof transactionId !== "string" || transactionId.length === 0) {
      return badRequest("transaction_id is required");
    }

    // Ownership, not visibility. RLS now also exposes a household member's
    // shared transactions, so `user_id` must be explicit here — mirroring
    // annotate-batch. Without it a member could attach splits to the owner's
    // transaction, and validate_transaction_split_total() sums splits across
    // users, which would permanently block the owner from splitting it.
    const { data: txn } = await supabase
      .from("transactions")
      .select("id, amount, date")
      .eq("id", transactionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!txn) return badRequest("Transaction not found");
    const absAmount = Math.abs(Number(txn.amount));

    // --- Goal link (Phase 7) ---
    // Absent key means "leave the link alone"; an explicit null clears it.
    const goalState = await resolveGoal(supabase, user.id, body);
    if (!goalState.ok) return goalState.response;
    const { goalProvided, goalId, linkedGoal } = goalState;

    // --- Note + tags ---
    await saveAnnotation(supabase, user.id, transactionId, body);

    // --- Splits ---
    if (body?.splits !== undefined) {
      const splitResponse = await saveSplits(
        supabase,
        user.id,
        transactionId,
        absAmount,
        body.splits,
      );
      if (splitResponse) return splitResponse;
    }

    // --- Goal progress event (Phase 7) ---
    // Only a `spending_reduces` goal turns a transaction into progress, and it
    // does so negatively: money spent against a save-up goal sets it back.
    await saveGoalProgress(
      supabase,
      user.id,
      transactionId,
      txn as { amount: number | string; date: string },
      goalProvided,
      goalId,
      linkedGoal,
      request,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("transactions.annotate", error);
  }
}
