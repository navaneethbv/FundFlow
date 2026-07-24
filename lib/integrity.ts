/**
 * Pure data-integrity checks over a user's rows. The daily cron feeds these
 * with bounded queries and alerts the admin when anything surfaces —
 * catching corruption early, before it compounds into wrong reports.
 */

export interface IntegrityFinding {
  check: "stuck-sync-job" | "orphan-transaction" | "duplicate-plaid-id" | "stale-pending";
  count: number;
  detail: string;
}

const STUCK_AFTER_MS = 24 * 3600 * 1000;
const PENDING_STALE_DAYS = 7;

export function runIntegrityChecks(input: {
  nowMs: number;
  syncJobs: { status: string; updatedAt: string }[];
  transactions: {
    id: string;
    accountId: string;
    plaidTransactionId: string | null;
    pending?: boolean;
    date?: string;
  }[];
  accountIds: string[];
}): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];

  const stuck = input.syncJobs.filter(
    (job) =>
      job.status === "running" &&
      input.nowMs - Date.parse(job.updatedAt) > STUCK_AFTER_MS,
  );
  if (stuck.length > 0) {
    findings.push({
      check: "stuck-sync-job",
      count: stuck.length,
      detail: `${stuck.length} sync job(s) stuck in running for over 24h.`,
    });
  }

  const accounts = new Set(input.accountIds);
  const orphans = input.transactions.filter((txn) => !accounts.has(txn.accountId));
  if (orphans.length > 0) {
    findings.push({
      check: "orphan-transaction",
      count: orphans.length,
      detail: `${orphans.length} transaction(s) reference missing accounts (first: ${orphans[0]!.id}).`,
    });
  }

  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const txn of input.transactions) {
    if (!txn.plaidTransactionId) continue; // imports have no Plaid id
    if (seen.has(txn.plaidTransactionId)) dupes.add(txn.plaidTransactionId);
    seen.add(txn.plaidTransactionId);
  }
  if (dupes.size > 0) {
    findings.push({
      check: "duplicate-plaid-id",
      count: dupes.size,
      detail: `${dupes.size} duplicated plaid_transaction_id value(s) (first: ${[...dupes][0]}).`,
    });
  }

  // Pending rows that never settled (Bucket 2): Plaid replaces pending
  // transactions with posted ones within days — a week-old pending row is
  // a hold that never cleared or a sync gap worth a look.
  const staleCutoff = new Date(input.nowMs - PENDING_STALE_DAYS * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const stalePending = input.transactions.filter(
    (txn) => txn.pending === true && txn.date !== undefined && txn.date < staleCutoff,
  );
  if (stalePending.length > 0) {
    findings.push({
      check: "stale-pending",
      count: stalePending.length,
      detail: `${stalePending.length} transaction(s) pending for over ${PENDING_STALE_DAYS} days (first: ${stalePending[0]!.id}).`,
    });
  }

  return findings;
}
