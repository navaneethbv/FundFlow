import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { groupKeyFor } from "@/lib/accounts-page";
import { toCsv } from "@/lib/csv";
import {
  parseFinancialScope,
  scopeQueryUserId,
} from "@/lib/financial-scope";
import { errorResponse, requireUser } from "@/lib/http";

interface PlaidCsvRow {
  id: string;
  user_id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | string | null;
  iso_currency_code: string | null;
  updated_at: string;
}

interface ManualCsvRow {
  id: string;
  user_id: string;
  name: string;
  account_type: string;
  balance: number | string | null;
  updated_at: string;
}

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function displayBalance(
  type: string | null,
  subtype: string | null,
  value: number | null,
): number | null {
  if (value === null) return null;
  const group = groupKeyFor(type, subtype);
  return group === "credit" || group === "loan" ? Math.abs(value) : value;
}

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const { data: householdRows, error: householdError } = await supabase
      .from("households")
      .select("id");
    if (householdError) throw householdError;
    const visibleHouseholdIds = (householdRows ?? []).map(
      (row) => row.id as string,
    );
    const scope = parseFinancialScope({
      raw: new URL(request.url).searchParams.get("scope") ?? undefined,
      ownerUserId: user.id,
      visibleHouseholdIds,
    });
    const queryUserId = scopeQueryUserId(scope);

    let plaidQuery = supabase
      .from("accounts")
      .select(
        "id,user_id,name,mask,type,subtype,current_balance,iso_currency_code,updated_at",
      )
      .order("name");
    let manualQuery = supabase
      .from("manual_accounts")
      .select("id,user_id,name,account_type,balance,updated_at")
      .order("name");
    if (queryUserId) {
      plaidQuery = plaidQuery.eq("user_id", queryUserId);
      manualQuery = manualQuery.eq("user_id", queryUserId);
    }

    const [plaidResult, manualResult] = await Promise.all([
      plaidQuery,
      manualQuery,
    ]);
    if (plaidResult.error) throw plaidResult.error;
    if (manualResult.error) throw manualResult.error;

    const rows = [
      ...((plaidResult.data ?? []) as PlaidCsvRow[]).map((account) => {
        const name = `${account.name?.trim() || "Account"}${
          account.mask ? ` (...${account.mask})` : ""
        }`;
        return {
          group: groupKeyFor(account.type, account.subtype),
          name,
          subtype: account.subtype,
          balance: displayBalance(
            account.type,
            account.subtype,
            numeric(account.current_balance),
          ),
          currency: account.iso_currency_code?.toUpperCase() || "USD",
          asOf: account.updated_at.slice(0, 10),
        };
      }),
      ...((manualResult.data ?? []) as ManualCsvRow[]).map((account) => ({
        group: groupKeyFor(account.account_type, null),
        name: account.name,
        subtype: account.account_type,
        balance: displayBalance(
          account.account_type,
          null,
          numeric(account.balance),
        ),
        currency: "USD",
        asOf: account.updated_at.slice(0, 10),
      })),
    ].sort(
      (a, b) =>
        a.group.localeCompare(b.group) || a.name.localeCompare(b.name),
    );

    const csv = toCsv(
      ["group", "name", "subtype", "balance", "currency", "as_of"],
      rows.map((row) => [
        row.group,
        row.name,
        row.subtype,
        row.balance,
        row.currency,
        row.asOf,
      ]),
    );
    await writeAudit({
      userId: user.id,
      action: "data_export",
      metadata: { kind: "accounts_csv", rows: rows.length },
      ip: getClientIp(request),
    });

    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition":
          'attachment; filename="fundflow-accounts.csv"',
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("export.accounts-csv", error);
  }
}
