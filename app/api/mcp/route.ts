import { NextResponse, type NextRequest } from "next/server";
import { fetchPrivacySafeRows } from "@/lib/export";
import { verifyApiToken, type ApiTokenScope } from "@/lib/api-tokens";
import { errorResponse, badRequest } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { getClientIp, writeAudit } from "@/lib/audit";
import { addDays } from "@/lib/date-utils";
import { loadCanonicalProjection } from "@/lib/finance-query";
import {
  buildMcpAggregateRows,
  buildMcpNetWorthTrend,
  buildMcpRecurringRows,
  type McpRecurringInput,
} from "@/lib/mcp-projections";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
const CATEGORY_MAX_LENGTH = 80;
const RESOURCE_NAMES = ["aggregates", "rows"] as const;
type McpResource = (typeof RESOURCE_NAMES)[number];

interface McpRequestInput {
  resource: McpResource;
  start: string;
  end: string;
  category: string | null;
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toISOString().slice(0, 10) === value;
}

function defaultPeriod(): { start: string; end: string } {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(`${end}T00:00:00.000Z`);
  start.setUTCMonth(start.getUTCMonth() - 5, 1);
  return { start: start.toISOString().slice(0, 10), end };
}

function parseInput(value: Record<string, unknown>): McpRequestInput | NextResponse {
  const defaults = defaultPeriod();
  const resource = value.resource ?? "aggregates";
  const start = value.start ?? defaults.start;
  const end = value.end ?? defaults.end;
  const category = value.category === undefined || value.category === null
    ? null
    : typeof value.category === "string"
      ? value.category.trim() || null
      : null;
  if (!RESOURCE_NAMES.includes(resource as McpResource)) {
    return badRequest("resource must be aggregates or rows");
  }
  if (!isValidDate(start) || !isValidDate(end)) {
    return badRequest("start and end must be valid YYYY-MM-DD dates");
  }
  if (end < start) return badRequest("end must not be before start");
  const rangeDays = Math.floor(
    (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000,
  );
  if (rangeDays > MAX_RANGE_DAYS) return badRequest("date range is limited to 366 days");
  if (category !== null && category.length > CATEGORY_MAX_LENGTH) {
    return badRequest("category is too long");
  }
  return { resource: resource as McpResource, start, end, category };
}

async function loadAggregateProjection(
  userId: string,
  input: McpRequestInput,
): Promise<Record<string, unknown>> {
  const service = createServiceClient();
  const endExclusive = addDays(input.end, 1);
  const startMonth = `${input.start.slice(0, 7)}-01`;
  const endMonth = `${input.end.slice(0, 7)}-01`;
  const [projection, budgetsResult, streamsResult, manualResult, snapshotsResult] = await Promise.all([
    loadCanonicalProjection(service, {
      scope: { kind: "mine", ownerUserId: userId },
      window: { start: input.start, endExclusive },
      excludePending: true,
      maxRows: 25_000,
    }),
    service.from("budgets").select("category,monthly_limit").eq("user_id", userId).order("category").range(0, 199),
    service
      .from("recurring_streams")
      .select("stream_type,average_amount,last_amount,frequency,category,is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("category")
      .range(0, 199),
    service
      .from("manual_recurring_items")
      .select("amount,frequency,item_type,category,enabled")
      .eq("user_id", userId)
      .eq("enabled", true)
      .order("category")
      .range(0, 199),
    service
      .from("net_worth_snapshots")
      .select("snapshot_month,assets,liabilities")
      .eq("user_id", userId)
      .gte("snapshot_month", startMonth)
      .lte("snapshot_month", endMonth)
      .order("snapshot_month")
      .range(0, 199),
  ]);
  for (const result of [budgetsResult, streamsResult, manualResult, snapshotsResult]) {
    if (result.error) throw result.error;
  }

  const recurringRows: McpRecurringInput[] = [
    ...((streamsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      amount: (row.average_amount ?? row.last_amount) as number | string | null,
      frequency: row.frequency as string | null,
      category: row.category as string | null,
      itemType: row.stream_type as string | null,
      isActive: row.is_active as boolean | undefined,
    })),
    ...((manualResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      amount: row.amount as number | string | null,
      frequency: row.frequency as string | null,
      category: row.category as string | null,
      itemType: row.item_type as string | null,
      enabled: row.enabled as boolean | undefined,
    })),
  ];

  return {
    period: { start: input.start, end: input.end },
    monthlyCategories: buildMcpAggregateRows(projection.transactions, input.category),
    budgets: ((budgetsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      category: String(row.category ?? "UNCATEGORIZED"),
      monthlyLimit: Number(row.monthly_limit ?? 0),
    })),
    recurring: buildMcpRecurringRows(recurringRows),
    netWorthTrend: buildMcpNetWorthTrend(
      (snapshotsResult.data ?? []) as Array<{
        snapshot_month: string;
        assets: number | string | null;
        liabilities: number | string | null;
      }>,
    ),
  };
}

async function handle(request: NextRequest, input: McpRequestInput): Promise<NextResponse> {
  const ip = getClientIp(request) ?? "unknown";
  if (!(await checkRateLimit(`mcp-ip:${ip}`, 60, 3600, { failClosed: true }))) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  const requiredScope: ApiTokenScope = input.resource === "rows" ? "mcp:export-rows" : "mcp:aggregates";
  let token: Awaited<ReturnType<typeof verifyApiToken>>;
  try {
    token = await verifyApiToken(request.headers.get("authorization"), requiredScope);
  } catch (error) {
    return errorResponse("mcp.token-lookup", error, 503);
  }
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkRateLimit(`mcp-user:${token.userId}`, 120, 3600, { failClosed: true }))) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    if (input.resource === "rows") {
      const result = await fetchPrivacySafeRows(createServiceClient(), token.userId, {
        startDate: input.start,
        endDate: input.end,
      });
      if (!result.allowed) {
        return NextResponse.json({ error: "Data export is disabled in your settings." }, { status: 403 });
      }
      const category = input.category?.toUpperCase();
      const rows = category
        ? result.rows.filter((row) => row.category.toUpperCase() === category)
        : result.rows;
      await writeAudit({
        userId: token.userId,
        action: "mcp_export_read",
        metadata: { start: input.start, end: input.end, row_count: rows.length },
        ip,
      });
      return NextResponse.json({ resource: "rows", period: { start: input.start, end: input.end }, rows });
    }

    const projection = await loadAggregateProjection(token.userId, input);
    await writeAudit({
      userId: token.userId,
      action: "mcp_aggregate_read",
      metadata: { start: input.start, end: input.end, category: input.category },
      ip,
    });
    return NextResponse.json({ resource: "aggregates", ...projection });
  } catch (error) {
    return errorResponse("mcp.read", error);
  }
}

export async function GET(request: NextRequest) {
  if (!isFeatureEnabled("mcpEndpoint")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = parseInput(query);
  if (parsed instanceof NextResponse) return parsed;
  return handle(request, parsed);
}

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled("mcpEndpoint")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || Array.isArray(body)) return badRequest("JSON object required");
  const parsed = parseInput(body);
  if (parsed instanceof NextResponse) return parsed;
  return handle(request, parsed);
}
