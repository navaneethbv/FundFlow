export const MAX_STATEMENT_BYTES = 15 * 1024 * 1024;
export const STATEMENT_MONTHS = 12;

export type StatementAccountRef =
  | { source: "account"; id: string }
  | { source: "manual"; id: string };

export interface StatementMetadata {
  id: string;
  accountId: string | null;
  manualAccountId: string | null;
  statementMonth: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface StatementCoverageAccount {
  ref: StatementAccountRef;
  label: string;
}

export type StatementCoverageStatus = "missing" | "covered" | "duplicate";

export interface StatementCoverageCell {
  account: StatementAccountRef;
  month: string;
  count: number;
  status: StatementCoverageStatus;
}

export function parseStatementAccountRef(value: unknown): StatementAccountRef | null {
  if (typeof value !== "string") return null;
  const match = /^(account|manual):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(value.trim());
  if (!match) return null;
  const source = match[1]?.toLowerCase();
  const id = match[2];
  if (!id || (source !== "account" && source !== "manual")) return null;
  return { source, id };
}

export function isStatementMonth(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-01$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function recentStatementMonths(
  anchor = new Date(),
  count = STATEMENT_MONTHS,
): string[] {
  const months: string[] = [];
  const safeCount = Math.max(1, Math.min(24, Math.floor(count)));
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  for (let offset = safeCount - 1; offset >= 0; offset -= 1) {
    const total = year * 12 + month - offset;
    const itemYear = Math.floor(total / 12);
    const itemMonth = (total % 12) + 1;
    months.push(`${itemYear}-${String(itemMonth).padStart(2, "0")}-01`);
  }
  return months;
}

export function coverageStatus(count: number): StatementCoverageStatus {
  if (count <= 0) return "missing";
  if (count === 1) return "covered";
  return "duplicate";
}

export function buildStatementCoverage(
  accounts: readonly StatementCoverageAccount[],
  statements: readonly StatementMetadata[],
  months: readonly string[],
): StatementCoverageCell[] {
  return accounts.flatMap((account) =>
    months.map((month) => {
      const count = statements.filter(
        (statement) =>
          statement.statementMonth === month &&
          ((account.ref.source === "account" && statement.accountId === account.ref.id) ||
            (account.ref.source === "manual" && statement.manualAccountId === account.ref.id)),
      ).length;
      return { account: account.ref, month, count, status: coverageStatus(count) };
    }),
  );
}

export function sanitizeStatementFilename(value: string): string {
  const trimmed = value.trim().replaceAll(/[\\/\0]/g, "-");
  return trimmed.slice(0, 180) || "statement.pdf";
}
