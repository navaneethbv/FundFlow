import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { validateSplits } from "@/lib/transaction-quality";

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

    // The split/annotation RLS only checks user_id = auth.uid(), not that the
    // referenced transaction is the caller's. Verify ownership via the
    // RLS-scoped client (returns null for another user's transaction).
    const { data: txn } = await supabase
      .from("transactions")
      .select("id, amount")
      .eq("id", transactionId)
      .maybeSingle();
    if (!txn) return badRequest("Transaction not found");
    const absAmount = Math.abs(Number(txn.amount));

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

    if (!note && tags.length === 0) {
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
          { user_id: user.id, transaction_id: transactionId, note, tags },
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

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("transactions.annotate", error);
  }
}
