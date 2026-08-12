import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { groupKeyFor } from "@/lib/accounts-page";
import { toCsv } from "@/lib/csv";
import { isExportAllowed } from "@/lib/export";
import {
  parseFinancialScope,
  scopeQueryUserId,
} from "@/lib/financial-scope";
import { errorResponse, requireUser } from "@/lib/http";

type PlaidCsvRow = {
  id: string;
  user_id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | string | null;
  iso_currency_code: string | null;
  updated_at: string;
};

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

/** The `/accounts` hidden-account preference, defensively parsed. */
function hiddenAccountIds(dashboardPrefs: unknown): Set<string> {
  if (!dashboardPrefs || typeof dashboardPrefs !== "object") return new Set();
  const page = (dashboardPrefs as { accountsPage?: unknown }).accountsPage;
  if (!page || typeof page !== "object") return new Set();
  const ids = (page as { hiddenIds?: unknown }).hiddenIds;
  if (!Array.isArray(ids)) return new Set();
  return new Set(ids.filter((id): id is string => typeof id === "string"));
}

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    if (!(await isExportAllowed(supabase, user.id))) {
      return NextResponse.json(
        { error: "Data export is disabled in your settings." },
        { status: 403 },
      );
    }

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

    const [plaidResult, manualResult, profileResult] = await Promise.all([
      plaidQuery,
      manualQuery,
      supabase
        .from("profiles")
        .select("dashboard_prefs")
        .eq("id", user.id)
        .maybeSingle(),
    ]);
    if (plaidResult.error) throw plaidResult.error;
    if (manualResult.error) throw manualResult.error;
    if (profileResult.error) throw profileResult.error;

    // An account the user hid on /accounts stays out of the export too —
    // finding it in the CSV would contradict the visibility they chose.
    const hiddenIds = hiddenAccountIds(profileResult.data?.dashboard_prefs);

    const rows = [
      ...((plaidResult.data ?? []) as PlaidCsvRow[])
        .filter((account) => !hiddenIds.has(account.id))
        .map((account) => {
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
      ...((manualResult.data ?? []) as ManualCsvRow[])
        .filter((account) => !hiddenIds.has(account.id))
        .map((account) => ({
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
