import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StatementVault from "@/components/settings/StatementVault";
import {
  buildStatementCoverage,
  coverageStatus,
  isStatementMonth,
  parseStatementAccountRef,
  recentStatementMonths,
  sanitizeStatementFilename,
  type StatementCoverageAccount,
  type StatementMetadata,
} from "@/lib/statement-vault";

const account: StatementCoverageAccount = {
  ref: { source: "account", id: "11111111-1111-4111-8111-111111111111" },
  label: "Checking",
};
const manual: StatementCoverageAccount = {
  ref: { source: "manual", id: "22222222-2222-4222-8222-222222222222" },
  label: "Cash (manual)",
};

function statement(overrides: Partial<StatementMetadata> = {}): StatementMetadata {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    accountId: account.ref.id,
    manualAccountId: null,
    statementMonth: "2026-09-01",
    originalFilename: "statement.pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    createdAt: "2026-10-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("statement vault domain helpers", () => {
  it("requires UUID account references and distinguishes connected from manual accounts", () => {
    expect(parseStatementAccountRef(`account:${account.ref.id}`)).toEqual(account.ref);
    expect(parseStatementAccountRef(`manual:${manual.ref.id}`)).toEqual(manual.ref);
    expect(parseStatementAccountRef("account:not-an-id")).toBeNull();
    expect(parseStatementAccountRef("account:11111111-1111-4111-8111-111111111111/other")).toBeNull();
  });

  it("accepts real month starts only and returns a bounded oldest-to-newest window", () => {
    expect(isStatementMonth("2026-02-01")).toBe(true);
    expect(isStatementMonth("2026-02-30")).toBe(false);
    expect(isStatementMonth("2026-02-02")).toBe(false);
    expect(recentStatementMonths(new Date("2026-01-15T00:00:00Z"), 3)).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
    ]);
  });

  it("marks missing, covered, and duplicate cells independently per account", () => {
    const coverage = buildStatementCoverage(
      [account, manual],
      [statement(), statement({ id: "44444444-4444-4444-8444-444444444444" }), statement({ accountId: null, manualAccountId: manual.ref.id })],
      ["2026-08-01", "2026-09-01"],
    );
    expect(coverage.map((cell) => [cell.account.source, cell.month, cell.status, cell.count])).toEqual([
      ["account", "2026-08-01", "missing", 0],
      ["account", "2026-09-01", "duplicate", 2],
      ["manual", "2026-08-01", "missing", 0],
      ["manual", "2026-09-01", "covered", 1],
    ]);
    expect(coverageStatus(0)).toBe("missing");
    expect(coverageStatus(1)).toBe("covered");
    expect(coverageStatus(2)).toBe("duplicate");
  });

  it("sanitizes uploaded filenames without preserving path separators", () => {
    expect(sanitizeStatementFilename("  ../bank\\october.pdf  ")).toBe("..-bank-october.pdf");
    expect(sanitizeStatementFilename("\0")).toBe("-");
  });
});

describe("statement vault surface", () => {
  it("renders an accessible text-labelled coverage grid and deleteable metadata list", () => {
    const html = renderToStaticMarkup(
      createElement(StatementVault, {
        accounts: [account, manual],
        months: ["2026-08-01", "2026-09-01"],
        initialStatements: [statement()],
      }),
    );
    expect(html).toContain("Statement coverage by account and month");
    expect(html).toContain("Missing");
    expect(html).toContain("Duplicate");
    expect(html).toContain("statement.pdf");
    expect(html).toContain("Delete");
  });
});
