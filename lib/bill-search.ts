import type { SupabaseClient } from "@supabase/supabase-js";
import { accountDisplayLabel } from "@/lib/account-label";
import { normalizeLedgerAmount, sanitizeLedgerSearch } from "@/lib/ledger-query";
import { titleCase } from "@/lib/format";

/** Enough to find one bill; the full ledger is the place for a long list. */
export const BILL_SEARCH_LIMIT = 50;
const MAX_QUERY_LENGTH = 80;
const MIN_TEXT_LENGTH = 2;

export type BillQuery =
  | { kind: "empty" }
  | { kind: "amount"; amount: string }
  | { kind: "text"; term: string };

/**
 * A query that reads as money ("42", "$42.10", "1,204.99") searches by amount,
 * anything else by provider name. The text term goes through the ledger's
 * sanitizer because it is interpolated into a PostgREST `or()` filter.
 */
export function parseBillQuery(raw: string | null | undefined): BillQuery {
  const trimmed = (raw ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  if (!trimmed) return { kind: "empty" };
  const money = trimmed.replace(/^\$\s*/, "").replaceAll(",", "");
  const amount = normalizeLedgerAmount(money);
  if (amount) return { kind: "amount", amount };
  const term = sanitizeLedgerSearch(trimmed);
  if (term.length < MIN_TEXT_LENGTH) return { kind: "empty" };
  return { kind: "text", term };
}

export interface BillMatch {
  id: string;
  date: string;
  /** ISO timestamp from the institution, or null when it reports none. */
  time: string | null;
  provider: string;
  description: string | null;
  /** Absolute value, in `currency`. */
  total: number;
  direction: "charge" | "refund";
  currency: string;
  category: string | null;
  pending: boolean;
  paymentChannel: string | null;
  /** The card or account the money moved through, e.g. "Sapphire ••1234". */
  paidWith: string;
  paidWithType: string | null;
}

type BillRow = {
  id: string;
  date: string;
  authorized_date: string | null;
  amount: number | string;
  iso_currency_code: string | null;
  name: string | null;
  merchant_name: string | null;
  pfc_primary: string | null;
  payment_channel: string | null;
  pending: boolean | null;
  account_id: string | null;
  manual_account_id?: string | null;
  datetime?: string | null;
  authorized_datetime?: string | null;
};

type AccountRow = { id: string; name: string | null; mask: string | null; type: string | null; subtype: string | null };
type ManualAccountRow = { id: string; name: string | null; account_type: string | null };

export interface BillSearchOptions {
  /** Reads Plaid's time columns; only once their migration is applied. */
  includeTime: boolean;
  /** Joins manual-account names; only where `manual_account_id` exists. */
  includeManualAccounts: boolean;
}

export interface BillSearchResult {
  matches: BillMatch[];
  /** True when more rows matched than `BILL_SEARCH_LIMIT`. */
  truncated: boolean;
}

function billColumns(options: BillSearchOptions): string {
  const columns = [
    "id", "date", "authorized_date", "amount", "iso_currency_code", "name", "merchant_name",
    "pfc_primary", "payment_channel", "pending", "account_id",
  ];
  if (options.includeManualAccounts) columns.push("manual_account_id");
  if (options.includeTime) columns.push("datetime", "authorized_datetime");
  return columns.join(",");
}

function describeAccountType(type: string | null, subtype: string | null): string | null {
  if (subtype === "credit card" || type === "credit") return "Credit card";
  if (subtype === "checking" || subtype === "savings") return `Debit (${subtype})`;
  if (subtype) return titleCase(subtype);
  return type ? titleCase(type) : null;
}

function paidWithFor(
  row: BillRow,
  accounts: ReadonlyMap<string, AccountRow>,
  manualAccounts: ReadonlyMap<string, ManualAccountRow>,
): { label: string; type: string | null } {
  const account = row.account_id ? accounts.get(row.account_id) : undefined;
  if (account) {
    return {
      label: accountDisplayLabel(account.name, account.mask),
      type: describeAccountType(account.type, account.subtype),
    };
  }
  const manual = row.manual_account_id ? manualAccounts.get(row.manual_account_id) : undefined;
  if (manual) {
    return {
      label: manual.name || "Manual account",
      type: manual.account_type ? `Manual (${manual.account_type})` : "Manual",
    };
  }
  return { label: "Unknown account", type: null };
}

/** Plaid sign: positive = money out, so a positive amount is a charge. */
export function toBillMatch(
  row: BillRow,
  accounts: ReadonlyMap<string, AccountRow>,
  manualAccounts: ReadonlyMap<string, ManualAccountRow> = new Map(),
): BillMatch {
  const amount = Number(row.amount);
  const paidWith = paidWithFor(row, accounts, manualAccounts);
  return {
    id: row.id,
    date: row.authorized_date ?? row.date,
    time: row.authorized_datetime ?? row.datetime ?? null,
    provider: row.merchant_name || row.name || "Unknown provider",
    description: row.merchant_name && row.name && row.name !== row.merchant_name ? row.name : null,
    total: Math.abs(amount),
    direction: amount < 0 ? "refund" : "charge",
    currency: row.iso_currency_code ?? "USD",
    category: row.pfc_primary ? titleCase(row.pfc_primary.replaceAll("_", " ")) : null,
    pending: Boolean(row.pending),
    paymentChannel: row.payment_channel,
    paidWith: paidWith.label,
    paidWithType: paidWith.type,
  };
}

async function loadAccountMaps(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
  rows: BillRow[],
  includeManualAccounts: boolean,
): Promise<{ accounts: Map<string, AccountRow>; manualAccounts: Map<string, ManualAccountRow> }> {
  const accountIds = [...new Set(rows.map((row) => row.account_id).filter((id): id is string => Boolean(id)))];
  const manualIds = includeManualAccounts
    ? [...new Set(rows.map((row) => row.manual_account_id).filter((id): id is string => Boolean(id)))]
    : [];
  const [accountResult, manualResult] = await Promise.all([
    accountIds.length > 0
      ? supabase.from("accounts").select("id,name,mask,type,subtype").eq("user_id", userId).in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    manualIds.length > 0
      ? supabase.from("manual_accounts").select("id,name,account_type").eq("user_id", userId).in("id", manualIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (accountResult.error) throw accountResult.error;
  if (manualResult.error) throw manualResult.error;
  return {
    accounts: new Map(((accountResult.data ?? []) as AccountRow[]).map((row) => [row.id, row])),
    manualAccounts: new Map(((manualResult.data ?? []) as ManualAccountRow[]).map((row) => [row.id, row])),
  };
}

/**
 * Finds the signed-in user's transactions by provider name or exact amount
 * (either sign, so "42.10" finds the charge and its refund). Every query
 * filters `user_id` explicitly on top of RLS.
 */
export async function searchBills(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
  query: BillQuery,
  options: BillSearchOptions,
): Promise<BillSearchResult> {
  if (query.kind === "empty") return { matches: [], truncated: false };
  let request = supabase.from("transactions").select(billColumns(options)).eq("user_id", userId);
  request = query.kind === "amount"
    ? request.or(`amount.eq.${query.amount},amount.eq.-${query.amount}`)
    : request.or(`merchant_name.ilike.%${query.term}%,name.ilike.%${query.term}%`);
  const { data, error } = await request
    .order("date", { ascending: false })
    .order("id", { ascending: true })
    .limit(BILL_SEARCH_LIMIT + 1);
  if (error) throw error;
  const rows = (data ?? []) as unknown as BillRow[];
  const page = rows.slice(0, BILL_SEARCH_LIMIT);
  const { accounts, manualAccounts } = await loadAccountMaps(supabase, userId, page, options.includeManualAccounts);
  return {
    matches: page.map((row) => toBillMatch(row, accounts, manualAccounts)),
    truncated: rows.length > BILL_SEARCH_LIMIT,
  };
}

/** "3:42 PM" in the viewer's timezone, or null when no time was reported. */
export function formatBillTime(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" }).format(parsed);
  } catch {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(parsed);
  }
}

/** "2026-07-24" → "Fri, Jul 24, 2026"; a date key has no timezone to shift. */
export function formatBillDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(parsed);
}
