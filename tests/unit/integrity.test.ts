import { describe, expect, it } from "vitest";
import { runIntegrityChecks } from "@/lib/integrity";

const NOW = Date.parse("2026-07-23T12:00:00Z");

describe("runIntegrityChecks", () => {
  it("returns no findings for a healthy dataset", () => {
    const findings = runIntegrityChecks({
      nowMs: NOW,
      syncJobs: [{ status: "done", updatedAt: "2026-07-23T07:00:00Z" }],
      transactions: [
        { id: "t1", accountId: "a1", plaidTransactionId: "p1" },
        { id: "t2", accountId: "a1", plaidTransactionId: "p2" },
      ],
      accountIds: ["a1"],
    });
    expect(findings).toEqual([]);
  });

  it("flags sync jobs stuck in running for over 24 hours", () => {
    const findings = runIntegrityChecks({
      nowMs: NOW,
      syncJobs: [
        { status: "running", updatedAt: "2026-07-21T00:00:00Z" },
        { status: "running", updatedAt: "2026-07-23T11:00:00Z" },
      ],
      transactions: [],
      accountIds: [],
    });
    expect(findings).toEqual([
      expect.objectContaining({ check: "stuck-sync-job", count: 1 }),
    ]);
  });

  it("flags orphaned transactions and duplicate plaid ids", () => {
    const findings = runIntegrityChecks({
      nowMs: NOW,
      syncJobs: [],
      transactions: [
        { id: "t1", accountId: "gone", plaidTransactionId: "p1" },
        { id: "t2", accountId: "a1", plaidTransactionId: "dup" },
        { id: "t3", accountId: "a1", plaidTransactionId: "dup" },
        { id: "t4", accountId: "a1", plaidTransactionId: null },
        { id: "t5", accountId: "a1", plaidTransactionId: null },
      ],
      accountIds: ["a1"],
    });
    const checks = findings.map((f) => f.check);
    expect(checks).toContain("orphan-transaction");
    expect(checks).toContain("duplicate-plaid-id");
    // null plaid ids (imports) never count as duplicates
    expect(findings.find((f) => f.check === "duplicate-plaid-id")!.count).toBe(1);
  });

  it("flags pending transactions older than 7 days", () => {
    const findings = runIntegrityChecks({
      nowMs: NOW,
      syncJobs: [],
      transactions: [
        { id: "t1", accountId: "a1", plaidTransactionId: "p1", pending: true, date: "2026-07-10" },
        { id: "t2", accountId: "a1", plaidTransactionId: "p2", pending: true, date: "2026-07-22" },
        { id: "t3", accountId: "a1", plaidTransactionId: "p3", pending: false, date: "2026-07-01" },
      ],
      accountIds: ["a1"],
    });
    expect(findings).toEqual([
      expect.objectContaining({ check: "stale-pending", count: 1 }),
    ]);
  });
});
