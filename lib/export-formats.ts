import type { ExportRow } from "@/lib/export";
import { toCsv } from "@/lib/csv";

/**
 * Quicken Interchange Format (QIF) serializer.
 * Supported by Quicken, GnuCash, MoneyDance, and YNAB.
 */
export function toQif(rows: ExportRow[], accountType: "Bank" | "CCard" = "Bank"): string {
  const lines: string[] = [`!Type:${accountType}`];

  for (const row of rows) {
    const qifAmount = (-row.amount).toFixed(2);
    lines.push(
      `D${row.date}`,
      `T${qifAmount}`,
      `P${row.merchant}`,
      ...(row.category ? [`L${row.category}`] : []),
      "^",
    );
  }

  return lines.join("\n");
}

/**
 * Plain text accounting format serializer (compatible with Ledger CLI, hledger, Beancount).
 */
export function toLedgerCli(
  rows: ExportRow[],
  accountName = "Assets:Checking",
): string {
  const entries: string[] = [];

  for (const row of rows) {
    const categoryAccount = row.category
      ? `Expenses:${row.category.replace(/\W/g, ":")}`
      : "Expenses:Uncategorized";

    const amountFormatted = `$${Math.abs(row.amount).toFixed(2)}`;

    if (row.amount >= 0) {
      // Expense
      entries.push(
        `${row.date} ${row.merchant}\n    ${categoryAccount.padEnd(32)}  ${amountFormatted}\n    ${accountName}`,
      );
    } else {
      // Income
      entries.push(
        `${row.date} ${row.merchant}\n    ${accountName.padEnd(32)}  ${amountFormatted}\n    Income:Other`,
      );
    }
  }

  return entries.join("\n\n");
}

/**
 * Tax-ready Schedule C / Tax Prep CSV export.
 */
export function toTaxCsv(rows: ExportRow[]): string {
  const headers = ["Date", "Description", "Category", "Amount", "Type"];
  const csvRows = rows.map((r) => [
    r.date,
    r.merchant,
    r.category,
    r.amount,
    r.amount >= 0 ? "Expense" : "Income",
  ]);

  return toCsv(headers, csvRows);
}
