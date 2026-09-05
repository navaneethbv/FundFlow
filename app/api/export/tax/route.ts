import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { isExportAllowed } from "@/lib/export";
import {
  DEPENDENCY_CONCURRENCY,
  FINANCE_MAX_ROWS,
  loadCanonicalProjection,
  runBatched,
} from "@/lib/finance-query";
import { buildTaxExport } from "@/lib/tax-export";
import { toTaxCsv } from "@/lib/export-formats";
import { toCsv } from "@/lib/csv";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";

/**
 * The yearly tax export: every transaction in a calendar year the user tagged
 * with a tax line item (see lib/tax-categories.ts), through the canonical
 * projection so overrides, merchant rules, refunds, duplicates, and splits
 * appear exactly as they do on every other surface. Grouped by tax line item
 * with a per-line-item summary block.
 *
 * Same privacy contract as the other exports — date / merchant / amount /
 * category only, no balances, account numbers, or provider identifiers; the
 * merchant column carries the user's own transaction text verbatim, and
 * the same `ai_export_enabled` gate, failing closed. Data only: this is not
 * tax advice. Session-only by design (no API-token path): the export's meaning
 * depends on tags a script has no way to intend.
 *
 * Both reads filter `user_id` explicitly where the client could be the service
 * client, and the annotation read is chunked by transaction id like every
 * other bounded read (never an unbounded select on a table that grows
 * forever).
 */

const YEAR_REGEX = /^\d{4}$/;
const ANNOTATION_CHUNK_SIZE = 250;

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

    const yearParam = request.nextUrl.searchParams.get("year") ?? String(new Date().getUTCFullYear());
    if (!YEAR_REGEX.test(yearParam)) {
      return badRequest("Invalid year");
    }
    const year = Number(yearParam);
    const start = `${year}-01-01`;
    const endExclusive = `${year + 1}-01-01`;

    // Personal scope only: the tax export is the user's own filing helper, and
    // service-client callers must never leave `mine` scope (see financial-scope).
    const { transactions, truncated } = await loadCanonicalProjection(supabase, {
      scope: { kind: "mine", ownerUserId: user.id },
      window: { start, endExclusive },
      maxRows: FINANCE_MAX_ROWS,
    });

    const transactionIds = [...new Set(transactions.map((row) => row.sourceTransactionId))];
    const chunks: string[][] = [];
    for (let index = 0; index < transactionIds.length; index += ANNOTATION_CHUNK_SIZE) {
      chunks.push(transactionIds.slice(index, index + ANNOTATION_CHUNK_SIZE));
    }

    const annotationPages = await runBatched(
      chunks.map((chunk) => async () => {
        const { data, error } = await supabase
          .from("transaction_annotations")
          .select("transaction_id, tags")
          .in("transaction_id", chunk)
          .eq("user_id", user.id);
        if (error) throw error;
        return (data ?? []) as { transaction_id: string; tags: unknown }[];
      }),
      DEPENDENCY_CONCURRENCY,
    );

    const tagsByTransactionId = new Map<string, readonly string[]>();
    for (const page of annotationPages) {
      for (const row of page) {
        if (Array.isArray(row.tags) && row.tags.every((tag) => typeof tag === "string")) {
          tagsByTransactionId.set(row.transaction_id, row.tags as string[]);
        }
      }
    }

    const { rows, summary } = buildTaxExport(
      transactions.map((row) => ({
        sourceTransactionId: row.sourceTransactionId,
        date: row.date,
        merchant: row.merchant,
        signedAmount: row.signedAmount,
      })),
      tagsByTransactionId,
    );

    const detail = toTaxCsv(rows);
    const summaryCsv = toCsv(
      ["Tax line item", "Transactions", "Total"],
      summary.map((line) => [line.lineItem, line.count, line.total]),
    );
    const csv = summary.length > 0 ? `${detail}\r\n\r\n${summaryCsv}` : detail;

    const service = createServiceClient();
    await service.from("data_exports").insert({
      user_id: user.id,
      format: "csv",
      row_count: rows.length,
    });
    await writeAudit({
      userId: user.id,
      action: "data_export",
      metadata: {
        format: "csv",
        source: "tax",
        tax_year: year,
        row_count: rows.length,
        truncated,
      },
      ip: getClientIp(request),
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fundflow-tax-${year}.csv"`,
        "Cache-Control": "no-store",
        // The Settings page surfaces truncation too; this is for scripts.
        "X-FundFlow-Truncated": truncated ? "true" : "false",
      },
    });
  } catch (error) {
    return errorResponse("export.tax", error);
  }
}
