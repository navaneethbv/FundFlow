import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { validateSplits } from "@/lib/transaction-quality";
import { writeAudit, getClientIp } from "@/lib/audit";

interface SplitInput {
  category: string;
  amount: number;
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
    const goalProvided = body?.goal_id !== undefined;
    const goalId =
      typeof body?.goal_id === "string" && body.goal_id.trim()
        ? body.goal_id.trim()
        : null;
    let linkedGoal: { id: string; spending_reduces: boolean } | null = null;
    if (goalProvided && goalId) {
      const { data: goal } = await supabase
        .from("goals")
        .select("id, spending_reduces")
        .eq("id", goalId)
        .eq("user_id", user.id)
        .maybeSingle();
      // Ownership again, not visibility: a household member can see a shared
      // goal but must not be able to attach the owner's transaction to it.
      if (!goal) return badRequest("Goal not found");
      linkedGoal = goal as { id: string; spending_reduces: boolean };
    }

    // --- Note + tags ---
    const rawNote = typeof body?.note === "string" ? body.note.trim() : "";
    const note = rawNote.length ? rawNote.slice(0, 500) : null;
    const tags = Array.isArray(body?.tags)
      ? [
          ...new Set(
            (body.tags as unknown[])
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.trim())
              .filter((t) => t.length > 0 && t.length <= 40),
          ),
        ].slice(0, 20)
      : [];

    // The annotation row now carries three things, so it is only redundant once
    // all three are empty — deleting it while a goal link is set would silently
    // drop the link.
    const keepsGoalLink = goalProvided ? goalId !== null : false;
    if (!note && tags.length === 0 && !keepsGoalLink) {
      const { error } = await supabase
        .from("transaction_annotations")
        .delete()
        .eq("user_id", user.id)
        .eq("transaction_id", transactionId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("transaction_annotations")
        .upsert(
          {
            user_id: user.id,
            transaction_id: transactionId,
            note,
            tags,
            // Omitted when the caller did not mention it, so an unrelated note
            // edit cannot clear an existing link.
            ...(goalProvided ? { goal_id: goalId } : {}),
          },
          { onConflict: "user_id,transaction_id" },
        );
      if (error) throw error;
    }

    // --- Splits ---
    if (body?.splits !== undefined) {
      const rawSplits = Array.isArray(body.splits) ? body.splits : [];
      const splits: SplitInput[] = rawSplits
        .map((s: unknown) => {
          const row = s as { category?: unknown; amount?: unknown };
          return {
            category: typeof row.category === "string" ? row.category.trim() : "",
            amount: Math.round(Number(row.amount) * 100) / 100,
          };
        })
        .filter((s: SplitInput) => s.category.length > 0 && Number.isFinite(s.amount) && s.amount > 0);

      if (splits.length === 0) {
        // Clearing splits: remove existing rows (leaves a valid empty state).
        const { error } = await supabase
          .from("transaction_splits")
          .delete()
          .eq("user_id", user.id)
          .eq("transaction_id", transactionId);
        if (error) throw error;
      } else {
        const check = validateSplits(
          { id: transactionId, amount: absAmount, category: null },
          splits.map((s) => ({ transactionId, category: s.category, amount: s.amount })),
        );
        if (!check.valid) {
          return badRequest(
            `Splits must total ${absAmount.toFixed(2)} (off by ${check.difference.toFixed(2)}).`,
          );
        }
        // Replace all splits: delete then insert the new set in one array
        // insert so the deferred split-total DB trigger validates the complete
        // set in a single statement.
        const { error: delError } = await supabase
          .from("transaction_splits")
          .delete()
          .eq("user_id", user.id)
          .eq("transaction_id", transactionId);
        if (delError) throw delError;
        const { error: insError } = await supabase.from("transaction_splits").insert(
          splits.map((s) => ({
            user_id: user.id,
            transaction_id: transactionId,
            category: s.category,
            amount: s.amount,
          })),
        );
        if (insError) throw insError;
      }
    }

    // --- Goal progress event (Phase 7) ---
    // Only a `spending_reduces` goal turns a transaction into progress, and it
    // does so negatively: money spent against a save-up goal sets it back.
    if (goalProvided) {
      // Clear any event from a previous link first, so re-pointing a
      // transaction at another goal cannot leave progress behind on the old one.
      let stale = supabase
        .from("goal_progress_events")
        .delete()
        .eq("user_id", user.id)
        .eq("transaction_id", transactionId);
      if (goalId) stale = stale.neq("goal_id", goalId);
      const { error: staleError } = await stale;
      if (staleError) throw staleError;

      const isExpense = Number(txn.amount) > 0;
      if (linkedGoal?.spending_reduces && isExpense) {
        // Idempotent: unique (goal_id, transaction_id) means linking the same
        // transaction twice updates the one event rather than adding a second.
        const { error: eventError } = await supabase
          .from("goal_progress_events")
          .upsert(
            {
              user_id: user.id,
              goal_id: linkedGoal.id,
              transaction_id: transactionId,
              event_date: txn.date as string,
              amount: -absAmount,
              event_type: "transaction",
            },
            { onConflict: "goal_id,transaction_id" },
          );
        if (eventError) throw eventError;
      } else if (goalId) {
        // Linked to a goal that does not reduce on spend (or an inflow): the
        // link is informational, so no event may exist for it.
        const { error: removeError } = await supabase
          .from("goal_progress_events")
          .delete()
          .eq("user_id", user.id)
          .eq("transaction_id", transactionId)
          .eq("goal_id", goalId);
        if (removeError) throw removeError;
      }

      await writeAudit({
        userId: user.id,
        action: "goal_transaction_linked",
        metadata: { transaction_id: transactionId, goal_id: goalId },
        ip: getClientIp(request),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("transactions.annotate", error);
  }
}
