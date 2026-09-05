import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import {
  detectTransferPairs,
  filterReviewDecisions,
  transferSubjectId,
} from "@/lib/transaction-quality";

const WINDOW_DAYS = 7;
const LOOKBACK_DAYS = 60;
const PAGE_SIZE = 1_000;
const MAX_BULK_TRANSFERS = 100;
const BULK_CONCURRENCY = 8;

type PagedQueryResult = { data?: unknown; error?: unknown };

type TransferLedgerRow = {
  id: string;
  date: string;
  amount: number | string | null;
  merchant_name: string | null;
  name: string | null;
  account_id: string | null;
  manual_account_id: string | null;
};

type TransferDecisionRow = {
  subject_id: string;
  decision: "confirmed" | "dismissed";
};

type LinkedTransferRow = {
  out_transaction_id: string;
  in_transaction_id: string;
};

async function loadPaged<T>(
  loadPage: (from: number, to: number) => PromiseLike<PagedQueryResult>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; ; page += 1) {
    const result = await loadPage(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const batch = (result.data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Suggested inter-account transfer pairs (same amount, opposite sign, within
 * a short window, different accounts) awaiting review. Dismissed or already
 * linked pairs are hidden and stay hidden — decisions persist in
 * transaction_review_decisions under kind 'transfer'.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    if (!(await checkRateLimit(`transfers:${user.id}:read`, 60, 60))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const since = isoDaysAgo(LOOKBACK_DAYS);
    const [txns, decisions, linked] = await Promise.all([
      // Own ledger only: a link is a statement that two rows are one event,
      // which must never span two people's data.
      loadPaged<TransferLedgerRow>((from, to) =>
        supabase
          .from("transactions")
          .select("id, date, amount, merchant_name, name, account_id, manual_account_id")
          .eq("user_id", user.id)
          .gte("date", since)
          .order("date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
      loadPaged<TransferDecisionRow>((from, to) =>
        supabase
          .from("transaction_review_decisions")
          .select("subject_id, decision")
          .eq("user_id", user.id)
          .eq("kind", "transfer")
          .order("id", { ascending: true })
          .range(from, to),
      ),
      loadPaged<LinkedTransferRow>((from, to) =>
        supabase
          .from("linked_transfers")
          .select("out_transaction_id, in_transaction_id")
          .eq("user_id", user.id)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);

    const accountNames = new Map<string, string>();
    try {
      const [{ data: plaidAccs }, { data: manualAccs }] = await Promise.all([
        supabase.from("accounts").select("id, name").eq("user_id", user.id),
        supabase.from("manual_accounts").select("id, name").eq("user_id", user.id),
      ]);
      for (const a of (plaidAccs ?? []) as Array<{ id: string; name: string }>) {
        accountNames.set(a.id, a.name);
      }
      for (const m of (manualAccs ?? []) as Array<{ id: string; name: string }>) {
        accountNames.set(m.id, m.name);
      }
    } catch {
      // Fall back gracefully when account tables are omitted in test stubs
    }

    const alreadyLinkedIds = new Set(
      linked.flatMap((row) => [
        row.out_transaction_id as string,
        row.in_transaction_id as string,
      ]),
    );

    const ledger = (txns ?? [])
      .filter((row) => !alreadyLinkedIds.has(row.id as string))
      .map((row) => {
        const accId = (row.account_id ?? row.manual_account_id ?? "") as string;
        return {
          id: row.id as string,
          date: row.date as string,
          merchant: (row.merchant_name || row.name || "") as string,
          amount: Number(row.amount),
          accountId: accId,
          accountName: accountNames.get(accId) ?? "Account",
        };
      });
    const byId = new Map(ledger.map((row) => [row.id, row]));

    const alreadyLinked = new Set(
      linked.flatMap((row) => [
        `${row.out_transaction_id}:${row.in_transaction_id}`,
        row.out_transaction_id as string,
        row.in_transaction_id as string,
      ]),
    );
    const resolved = new Set(decisions.map((row) => row.subject_id as string));

    const pairs = detectTransferPairs(ledger, WINDOW_DAYS);
    const visible = filterReviewDecisions(
      pairs.map((pair) => ({
        kind: "transfer" as const,
        subjectId: pair.subjectId,
        message: "",
      })),
      decisions.map((row) => ({
        kind: "transfer" as const,
        subjectId: row.subject_id as string,
        decision: row.decision as "confirmed" | "dismissed",
      })),
    ).filter((anomaly) => !resolved.has(anomaly.subjectId) && !alreadyLinked.has(anomaly.subjectId));

    const pairBySubject = new Map(pairs.map((p) => [p.subjectId, p]));
    const pairsOut = visible.map((anomaly) => {
      const pair = pairBySubject.get(anomaly.subjectId)!;
      const out = byId.get(pair.outId);
      const inbound = byId.get(pair.inId);
      return {
        subject_id: pair.subjectId,
        out_id: pair.outId,
        in_id: pair.inId,
        amount: pair.amount,
        out_date: out?.date ?? null,
        in_date: inbound?.date ?? null,
        out_account_name: out?.accountName ?? "Account",
        in_account_name: inbound?.accountName ?? "Account",
        out_merchant: out?.merchant || "Outflow",
        in_merchant: inbound?.merchant || "Inflow",
      };
    });

    return NextResponse.json({ pairs: pairsOut });
  } catch (error) {
    return errorResponse("transactions.transfers", error);
  }
}

type TransferRow = {
  id: string;
  amount?: number | string | null;
  date?: string;
  account_id?: string | null;
  manual_account_id?: string | null;
};

function validateTransferPairProperties(outRow: TransferRow, inRow: TransferRow): string | null {
  const outAcc = outRow.account_id ?? outRow.manual_account_id;
  const inAcc = inRow.account_id ?? inRow.manual_account_id;
  if (outAcc && inAcc && outAcc === inAcc) {
    return "transfers must be between two different accounts";
  }

  if (outRow.date && inRow.date) {
    const dayDiff = Math.abs(new Date(inRow.date).getTime() - new Date(outRow.date).getTime()) / 86_400_000;
    if (dayDiff > WINDOW_DAYS) {
      return `transactions must be within ${WINDOW_DAYS} days of each other`;
    }
  }

  const outAmount = Number(outRow.amount);
  const inAmount = Number(inRow.amount);
  if (
    !Number.isFinite(outAmount) ||
    !Number.isFinite(inAmount) ||
    outAmount <= 0 ||
    inAmount >= 0 ||
    Math.round(Math.abs(outAmount) * 100) !== Math.round(Math.abs(inAmount) * 100)
  ) {
    return "transactions do not form a valid transfer pair";
  }

  return null;
}

async function checkTransferAlreadyLinked(
  linkedTable: ReturnType<SupabaseClient["from"]>,
  userId: string,
  outId: string,
  inId: string,
): Promise<string | null> {
  if (typeof linkedTable?.select !== "function") return null;
  const { data: existingLinks, error } = await linkedTable
    .select("out_transaction_id, in_transaction_id")
    .eq("user_id", userId)
    .or(`out_transaction_id.in.(${outId},${inId}),in_transaction_id.in.(${outId},${inId})`);
  // Let a query failure reach the route's error handler. Swallowing it here
  // would report "not linked" for a check that never ran.
  if (error) throw error;
  if (Array.isArray(existingLinks) && existingLinks.length > 0) {
    const isSelfMatch = existingLinks.every(
      (l) => l.out_transaction_id === outId && l.in_transaction_id === inId,
    );
    if (!isSelfMatch) {
      return "one or both transactions are already linked to another transfer";
    }
  }
  return null;
}

async function linkConfirmedTransfer(
  supabase: SupabaseClient,
  userId: string,
  subjectId: string,
  body: Record<string, unknown> | null,
): Promise<NextResponse | null> {
  const outId = body?.out_id;
  const inId = body?.in_id;
  if (typeof outId !== "string" || typeof inId !== "string") {
    return badRequest("out_id and in_id are required to link a transfer");
  }
  if (outId === inId) {
    return badRequest("a transfer needs two different transactions");
  }
  if (subjectId !== transferSubjectId(outId, inId)) {
    return badRequest("subject_id does not match the pair");
  }

  const { data: owned, error: verifyError } = await supabase
    .from("transactions")
    .select("id, amount, date, account_id, manual_account_id")
    .eq("user_id", userId)
    .in("id", [outId, inId]);
  if (verifyError) throw verifyError;
  if ((owned ?? []).length !== 2) {
    return badRequest("both sides of a transfer must be your own transactions");
  }

  const outRow = (owned as TransferRow[]).find((r) => r.id === outId);
  const inRow = (owned as TransferRow[]).find((r) => r.id === inId);
  if (!outRow || !inRow) {
    return badRequest("both sides of a transfer must be your own transactions");
  }

  const validationError = validateTransferPairProperties(outRow, inRow);
  if (validationError) return badRequest(validationError);

  const linkedTable = supabase.from("linked_transfers");
  const linkConflict = await checkTransferAlreadyLinked(linkedTable, userId, outId, inId);
  if (linkConflict) return badRequest(linkConflict);

  const outAmount = Number(outRow.amount);
  const { error: linkError } = await supabase.rpc("confirm_transfer_link", {
    p_user_id: userId,
    p_subject_id: subjectId,
    p_out_transaction_id: outId,
    p_in_transaction_id: inId,
    p_amount: Math.round(outAmount * 100) / 100,
  });
  if (linkError?.message?.includes("transfer_link_conflict")) {
    return NextResponse.json(
      { error: "One of these transactions is already linked to another transfer." },
      { status: 409 },
    );
  }
  if (linkError) throw linkError;
  return null;
}

type BulkTransferFailure = {
  subject_id: string | null;
  error: string;
};

type BulkTransferResult = {
  subjectId: string | null;
  failure?: BulkTransferFailure;
};

async function readLinkFailure(response: NextResponse): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : "Could not link transfer.";
}

async function linkBulkTransferCandidate(
  supabase: SupabaseClient,
  userId: string,
  candidate: unknown,
): Promise<BulkTransferResult> {
  const record = asRecord(candidate);
  const subjectId = typeof record?.subject_id === "string" ? record.subject_id : null;

  if (!record) {
    return {
      subjectId,
      failure: { subject_id: subjectId, error: "Each transfer must be an object." },
    };
  }

  try {
    const failure = await linkConfirmedTransfer(supabase, userId, subjectId ?? "", record);
    if (failure) {
      return {
        subjectId,
        failure: { subject_id: subjectId, error: await readLinkFailure(failure) },
      };
    }
    return { subjectId };
  } catch (error) {
    logError("transactions.transfers.bulk.item", error);
    return {
      subjectId,
      failure: { subject_id: subjectId, error: "Could not link transfer." },
    };
  }
}

async function linkBulkTransfers(
  supabase: SupabaseClient,
  userId: string,
  transfers: unknown[],
): Promise<{ linked: string[]; failures: BulkTransferFailure[] }> {
  const workers = Math.min(BULK_CONCURRENCY, transfers.length);
  const results = new Array<BulkTransferResult>(transfers.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < transfers.length) {
      const index = nextIndex++;
      results[index] = await linkBulkTransferCandidate(supabase, userId, transfers[index]);
    }
  }

  await Promise.all(Array.from({ length: workers }, worker));

  const linked: string[] = [];
  const failures: BulkTransferFailure[] = [];
  for (const result of results) {
    if (result.failure) failures.push(result.failure);
    else if (result.subjectId) linked.push(result.subjectId);
  }

  return { linked, failures };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getBulkTransfers(body: unknown): unknown[] | null {
  const record = asRecord(body);
  return record && Array.isArray(record.transfers) ? record.transfers : null;
}

async function handleBulkTransferRequest(
  supabase: SupabaseClient,
  userId: string,
  body: Record<string, unknown>,
  transfers: unknown[],
): Promise<NextResponse> {
  if (body.decision !== "confirmed") {
    return badRequest("bulk transfer requests must use the confirmed decision");
  }
  if (transfers.length === 0 || transfers.length > MAX_BULK_TRANSFERS) {
    return badRequest(`bulk transfer requests must contain between 1 and ${MAX_BULK_TRANSFERS} transfers`);
  }

  const result = await linkBulkTransfers(supabase, userId, transfers);
  return NextResponse.json(
    { ok: result.failures.length === 0, ...result },
    { status: result.failures.length > 0 ? 207 : 200 },
  );
}

async function handleSingleTransferRequest(
  supabase: SupabaseClient,
  userId: string,
  body: Record<string, unknown> | null,
): Promise<NextResponse> {
  const subjectId = body?.subject_id;
  const decision = body?.decision;
  if (typeof subjectId !== "string" || (decision !== "confirmed" && decision !== "dismissed")) {
    return badRequest("subject_id and a valid decision are required");
  }

  if (decision === "confirmed") {
    const linkFailure = await linkConfirmedTransfer(
      supabase,
      userId,
      subjectId,
      body,
    );
    if (linkFailure) return linkFailure;
  }

  if (decision === "dismissed") {
    const { error: decisionError } = await supabase
      .from("transaction_review_decisions")
      .upsert(
        { user_id: userId, kind: "transfer", subject_id: subjectId, decision },
        { onConflict: "user_id,kind,subject_id" },
      );
    if (decisionError) throw decisionError;
  }

  return NextResponse.json({ ok: true });
}

/** Record a transfer-pair decision; confirmed links and decisions commit atomically. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = await request.json().catch(() => null);
    const transfers = getBulkTransfers(body);
    const isBulk = transfers !== null;
    if (!(await checkRateLimit(
      `transfers:${user.id}:${isBulk ? "bulk" : "write"}`,
      isBulk ? 5 : 30,
      3600,
    ))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    if (transfers !== null) {
      return await handleBulkTransferRequest(supabase, user.id, asRecord(body)!, transfers);
    }
    return await handleSingleTransferRequest(supabase, user.id, asRecord(body));
  } catch (error) {
    return errorResponse("transactions.transfers.post", error);
  }
}
