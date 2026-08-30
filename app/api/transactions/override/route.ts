import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { writeAudit, getClientIp } from "@/lib/audit";
import { TRANSFER_GROUPS } from "@/lib/finance-domain";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CashFlowClassification = "expense" | "income";

interface OverrideBody {
  transaction_id?: unknown;
  display_category?: unknown;
  cash_flow_classification?: unknown;
  confirmed?: unknown;
}

/**
 * Normalize the provider category into a group key so a transfer/loan-payment
 * row can be detected before the user asks to reclassify it.
 */
function providerGroupKey(pfcPrimary: string | null, pfcDetailed: string | null): string | null {
  const primary = pfcPrimary?.trim().toUpperCase();
  if (primary) return primary;
  const detailed = pfcDetailed?.trim().toUpperCase();
  return detailed ?? null;
}

function hasOverrideField(body: OverrideBody | null, field: keyof OverrideBody): boolean {
  return Object.hasOwn(body ?? {}, field);
}

function parseDisplayCategory(
  body: OverrideBody | null,
  present: boolean,
): string | null | undefined {
  if (!present) return undefined;
  if (typeof body?.display_category !== "string") return null;
  const trimmed = body.display_category.trim();
  return trimmed ? trimmed.slice(0, 100) : null;
}

function parseCashFlowClassification(
  body: OverrideBody | null,
  present: boolean,
): CashFlowClassification | null | undefined {
  if (!present) return undefined;
  return body?.cash_flow_classification === "expense" || body?.cash_flow_classification === "income"
    ? body.cash_flow_classification
    : null;
}

function needsTransferConfirmation(
  classification: CashFlowClassification | null | undefined,
  txn: { pfc_primary: string | null; pfc_detailed: string | null },
  confirmed: unknown,
): boolean {
  if (!classification) return false;
  const groupKey = providerGroupKey(txn.pfc_primary, txn.pfc_detailed);
  return Boolean(groupKey && TRANSFER_GROUPS.has(groupKey) && confirmed !== true);
}

function nextOverrideValues(
  displayCategory: string | null | undefined,
  cashFlowClassification: CashFlowClassification | null | undefined,
  existingOverride: { display_category: string | null; cash_flow_classification: CashFlowClassification | null } | null,
): { displayCategory: string | null; cashFlowClassification: CashFlowClassification | null } {
  let nextDisplayCategory = displayCategory;
  if (nextDisplayCategory === undefined) {
    nextDisplayCategory = existingOverride?.display_category ?? null;
  }
  let nextCashFlowClassification = cashFlowClassification;
  if (nextCashFlowClassification === undefined) {
    nextCashFlowClassification = existingOverride?.cash_flow_classification ?? null;
  }
  return {
    displayCategory: nextDisplayCategory,
    cashFlowClassification: nextCashFlowClassification,
  };
}

/**
 * Set (POST) or clear (DELETE) a transaction-level classification override.
 *
 * The override lives on the owner-scoped transaction_annotations row; the
 * Plaid-synced transactions row (pfc_primary/pfc_detailed) is never touched.
 * Turning a provider transfer or loan payment into spending or income requires
 * an explicit `confirmed: true` — the UI only sends it after a deliberate
 * confirmation, and every create/update/delete is audited.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as OverrideBody | null;
    const transactionId = body?.transaction_id;
    if (typeof transactionId !== "string" || !UUID_REGEX.test(transactionId)) {
      return badRequest("Invalid transaction_id");
    }
    const hasDisplayCategory = hasOverrideField(body, "display_category");
    const hasClassification = hasOverrideField(body, "cash_flow_classification");
    if (
      hasDisplayCategory &&
      body?.display_category !== null &&
      typeof body?.display_category !== "string"
    ) {
      return badRequest("display_category must be a string or null");
    }
    if (
      hasClassification &&
      body?.cash_flow_classification !== null &&
      body?.cash_flow_classification !== "expense" &&
      body?.cash_flow_classification !== "income"
    ) {
      return badRequest("cash_flow_classification must be expense, income, or null");
    }
    const displayCategory = parseDisplayCategory(body, hasDisplayCategory);
    const cashFlowClassification = parseCashFlowClassification(body, hasClassification);
    if (displayCategory === undefined && cashFlowClassification === undefined) {
      return badRequest("Provide a display_category or cash_flow_classification");
    }

    // Ownership, not visibility: RLS exposes household-shared transactions, so
    // scope the lookup explicitly to the caller.
    const { data: txn } = await supabase
      .from("transactions")
      .select("id, pfc_primary, pfc_detailed")
      .eq("id", transactionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!txn) return badRequest("Transaction not found");

    // Deliberate-confirmation gate: turning a provider transfer or loan
    // payment into spending/income must be confirmed explicitly.
    if (needsTransferConfirmation(cashFlowClassification, {
      pfc_primary: txn.pfc_primary as string | null,
      pfc_detailed: txn.pfc_detailed as string | null,
    }, body?.confirmed)) {
      return badRequest(
        "This transaction is currently a transfer or loan payment. Confirm that you want it counted as cash flow before reclassifying it.",
      );
    }

    const existingOverride = await loadExistingOverride(supabase, user.id, transactionId);
    const next = nextOverrideValues(displayCategory, cashFlowClassification, existingOverride);

    const { error } = await supabase.from("transaction_annotations").upsert(
      {
        user_id: user.id,
        transaction_id: transactionId,
        display_category: next.displayCategory,
        cash_flow_classification: next.cashFlowClassification,
      },
      { onConflict: "user_id,transaction_id" },
    );
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: existingOverride ? "transaction_override_updated" : "transaction_override_created",
      metadata: {
        transaction_id: transactionId,
        display_category: next.displayCategory,
        cash_flow_classification: next.cashFlowClassification,
        confirmed: Boolean(body?.confirmed),
      },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("transactions.override", error);
  }
}

async function loadExistingOverride(
  supabase: SupabaseClient,
  userId: string,
  transactionId: string,
): Promise<{ display_category: string | null; cash_flow_classification: CashFlowClassification | null } | null> {
  const { data } = await supabase
    .from("transaction_annotations")
    .select("display_category, cash_flow_classification")
    .eq("user_id", userId)
    .eq("transaction_id", transactionId)
    .maybeSingle();
  const row = data as
    | { display_category?: string | null; cash_flow_classification?: CashFlowClassification | null }
    | null;
  if (!row) return null;
  return {
    display_category: row.display_category ?? null,
    cash_flow_classification: row.cash_flow_classification ?? null,
  };
}

/**
 * Clear the override for one owned transaction. Audited; the provider row is
 * untouched.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as { transaction_id?: unknown } | null;
    const transactionId = body?.transaction_id;
    if (typeof transactionId !== "string" || !UUID_REGEX.test(transactionId)) {
      return badRequest("Invalid transaction_id");
    }

    const { data: txn } = await supabase
      .from("transactions")
      .select("id")
      .eq("id", transactionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!txn) return badRequest("Transaction not found");

    const { error } = await supabase
      .from("transaction_annotations")
      .update({ display_category: null, cash_flow_classification: null })
      .eq("transaction_id", transactionId)
      .eq("user_id", user.id);
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "transaction_override_deleted",
      metadata: { transaction_id: transactionId },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("transactions.override", error);
  }
}
