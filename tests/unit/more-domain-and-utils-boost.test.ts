import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatRelativeTime,
  formatRelativeAnnotation,
  daysUntil,
  formatDueAnnotation,
  localDateKey,
  localMonthKey,
} from "@/lib/format-date";
import {
  formatCurrency,
  UNKNOWN_CURRENCY,
  titleCase,
  formatFrequency,
  formatMinutesAgo,
  hoursSince,
  daysSince,
  formatDay,
  formatMonth,
} from "@/lib/format";
import { compactCurrency } from "@/lib/chart-utils";
import {
  getCurrencySymbol,
  convertCurrency,
  formatMoneyWithFx,
} from "@/lib/currency";
import { getRecentTransactions } from "@/lib/recent-transactions";
import {
  normalizeReportTimezone,
  getWeeklyReportPeriod,
  isWeeklyReportDue,
} from "@/lib/report-period";
import {
  redactTakeoutSecrets,
  buildDataTakeout,
  buildAuditLogPage,
  buildSessionList,
} from "@/lib/security-account";
import {
  toQif,
  toLedgerCli,
  toTaxCsv,
} from "@/lib/export-formats";
import {
  parseDate,
  isoDate,
  addDays,
  addMonths,
} from "@/lib/date-utils";
import { clientStub } from "../fixtures/supabase-query";

describe("Format Date Full Branch Coverage", () => {
  it("formats date strings with YYYY-MM-DD, month overflow, ISO timestamps, and invalids", () => {
    expect(formatDate("2026-08-15")).toBe("Aug 15, 2026");
    expect(formatDate("2026-13-15")).toBe("2026-13-15"); // month overflow fallback
    expect(formatDate("2026-08-15T12:00:00Z")).toContain("2026");
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });

  it("formats relative time across all time bucket branches", () => {
    const now = new Date("2026-08-20T12:00:00Z");
    expect(formatRelativeTime("invalid", now)).toBe("unknown");
    expect(formatRelativeTime("2026-08-20T12:00:00Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-08-20T11:59:00Z", now)).toBe("1 minute ago");
    expect(formatRelativeTime("2026-08-20T11:30:00Z", now)).toBe("30 minutes ago");
    expect(formatRelativeTime("2026-08-20T11:00:00Z", now)).toBe("1 hour ago");
    expect(formatRelativeTime("2026-08-20T08:00:00Z", now)).toBe("4 hours ago");
    expect(formatRelativeTime("2026-08-19T12:00:00Z", now)).toBe("1 day ago");
    expect(formatRelativeTime("2026-08-15T12:00:00Z", now)).toBe("5 days ago");
    expect(formatRelativeTime("2026-07-20T12:00:00Z", now)).toBe("1 month ago");
    expect(formatRelativeTime("2026-05-20T12:00:00Z", now)).toBe("3 months ago");
    expect(formatRelativeTime("2025-08-20T12:00:00Z", now)).toBe("1 year ago");
    expect(formatRelativeTime("2024-08-20T12:00:00Z", now)).toBe("2 years ago");

    expect(formatRelativeAnnotation("2026-08-19T12:00:00Z", now)).toBe("(1 day ago)");
  });

  it("calculates daysUntil and formatDueAnnotation for all branches", () => {
    expect(daysUntil("bad", "2026-08-20")).toBe(0);
    expect(daysUntil("2026-08-20", "bad")).toBe(0);
    expect(daysUntil("2026-08-25", "2026-08-20")).toBe(5);

    expect(formatDueAnnotation(0)).toBe("today");
    expect(formatDueAnnotation(1)).toBe("in 1 day");
    expect(formatDueAnnotation(5)).toBe("in 5 days");
    expect(formatDueAnnotation(-1)).toBe("1 day ago");
    expect(formatDueAnnotation(-4)).toBe("4 days ago");

    expect(localDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(localMonthKey()).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("Format and Currency Full Branch Coverage", () => {
  it("formats currencies, titles, frequencies, minutes, hours, days, and months", () => {
    expect(formatCurrency(0)).toBe("$0.00");
    expect(formatCurrency(1234.56)).toBe("$1,234.56");
    expect(formatCurrency(-50)).toBe("-$50.00");
    expect(formatCurrency(100, UNKNOWN_CURRENCY)).toBe("100.00");
    expect(formatCurrency(100, "INVALID_CURRENCY")).toBe("$100.00");

    expect(compactCurrency(0)).toBe("$0");
    expect(compactCurrency(1500)).toBe("$1.5K");
    expect(compactCurrency(2000000)).toBe("$2M");

    expect(titleCase(null)).toBe("");
    expect(titleCase("")).toBe("");
    expect(titleCase("hello_world")).toBe("Hello World");

    expect(formatFrequency(null)).toBe("Recurring");
    expect(formatFrequency("UNKNOWN")).toBe("Recurring");
    expect(formatFrequency("monthly")).toBe("Monthly");

    expect(formatMinutesAgo(null)).toBe("never");
    expect(formatMinutesAgo(-5)).toBe("never");
    expect(formatMinutesAgo(0.5)).toBe("just now");
    expect(formatMinutesAgo(15)).toBe("15m ago");
    expect(formatMinutesAgo(120)).toBe("2h ago");
    expect(formatMinutesAgo(3000)).toBe("2d ago");

    expect(hoursSince(null)).toBeNull();
    expect(hoursSince("2026-08-20T00:00:00Z")).toBeGreaterThanOrEqual(0);

    expect(daysSince(null)).toBeNull();
    expect(daysSince("2026-08-20T00:00:00Z")).toBeGreaterThanOrEqual(0);

    expect(formatDay("2026-08-15")).toContain("Aug");
    expect(formatMonth("2026-08")).toContain("Aug");
  });

  it("resolves currency symbols, conversions, and fx formatting", () => {
    expect(getCurrencySymbol("USD")).toBe("$");
    expect(getCurrencySymbol("EUR")).toBe("€");
    expect(getCurrencySymbol("GBP")).toBe("£");
    expect(getCurrencySymbol("JPY")).toBe("¥");
    expect(getCurrencySymbol("UNKNOWN")).toBe("$");

    expect(convertCurrency(100, "USD", "USD")).toBe(100);
    expect(convertCurrency(100, "USD", "EUR")).toBeGreaterThan(0);

    const sameFx = formatMoneyWithFx(100, "USD", "USD");
    expect(sameFx.isConverted).toBe(false);

    const diffFx = formatMoneyWithFx(100, "USD", "EUR");
    expect(diffFx.isConverted).toBe(true);
  });
});

describe("Recent Transactions and Report Period Branches", () => {
  it("queries recent transactions with December rollover and user/account filtering", async () => {
    const client = clientStub({
      transactions: {
        data: [
          { id: "t1", date: "2026-12-05", amount: 50 },
        ],
      },
    });

    const txsDec = await getRecentTransactions({
      supabase: client as never,
      month: "2026-12",
      userId: "u-1",
      accountId: "a-1",
    });
    expect(txsDec).toHaveLength(1);

    const txsNoFilter = await getRecentTransactions({
      supabase: client as never,
      month: "2026-08",
    });
    expect(txsNoFilter).toHaveLength(1);
  });

  it("handles report timezone normalization, period calculation, and due checks", () => {
    expect(normalizeReportTimezone(null)).toBe("America/Los_Angeles");
    expect(normalizeReportTimezone("   ")).toBe("America/Los_Angeles");
    expect(normalizeReportTimezone("Invalid/Timezone")).toBe("America/Los_Angeles");
    expect(normalizeReportTimezone("America/New_York")).toBe("America/New_York");

    const ref = new Date("2026-08-17T15:00:00Z"); // Monday
    const period = getWeeklyReportPeriod(ref, "America/New_York");
    expect(period.start).toBeDefined();
    expect(period.end).toBeDefined();

    expect(isWeeklyReportDue(ref, "America/New_York", 8)).toBe(true);
    expect(isWeeklyReportDue(new Date("2026-08-18T15:00:00Z"), "America/New_York", 8)).toBe(true); // Tuesday
  });
});

describe("Security Account, Export Formats, and Date Utils", () => {
  it("redacts takeout secrets, audits log pages, and builds session list", () => {
    const takeout = buildDataTakeout({
      items: [
        { id: "1", public_name: "Test", api_key: "secret123", access_token: "tok" },
      ],
    });
    expect(takeout).toEqual({
      items: [{ id: "1", public_name: "Test" }],
    });

    expect(redactTakeoutSecrets("plain_string")).toBe("plain_string");

    const auditPage = buildAuditLogPage(
      [
        { userId: "u-1", action: "login", metadata: { ip_address: "1.2.3.4", browser: "Chrome" } },
        { userId: "u-2", action: "export", metadata: {} },
      ],
      "u-1",
      1,
    );
    expect(auditPage.rows).toHaveLength(1);
    expect(auditPage.rows[0]?.metadata.ip_address).toBe("[redacted]");
    expect(auditPage.nextCursor).toBeNull();

    const auditPageHasMore = buildAuditLogPage(
      [
        { userId: "u-1", action: "a1", metadata: {} },
        { userId: "u-1", action: "a2", metadata: {} },
      ],
      "u-1",
      1,
    );
    expect(auditPageHasMore.nextCursor).toBe("1");

    const sessions = buildSessionList([
      { id: "s1", current: true, userAgent: "Safari", lastSeenAt: "2026-08-20" },
      { id: "s2", current: false, userAgent: null, lastSeenAt: "2026-08-19" },
    ]);
    expect(sessions[1]?.label).toBe("Unknown device");
  });

  it("builds QIF, Ledger CLI, and Tax CSV exports", () => {
    const rows = [
      {
        date: "2026-08-01",
        account_name: "Checking",
        merchant: "Supermarket",
        category: "Groceries & Food",
        amount: 85.5,
      },
      {
        date: "2026-08-02",
        account_name: "Checking",
        merchant: "Employer",
        category: "",
        amount: -3000,
      },
    ];

    const qif = toQif(rows, "CCard");
    expect(qif).toContain("!Type:CCard");
    expect(qif).toContain("D2026-08-01");
    expect(qif).toContain("T-85.50");

    const ledger = toLedgerCli(rows);
    expect(ledger).toContain("Expenses:Groceries:::Food");
    expect(ledger).toContain("Income:Other");

    const taxCsv = toTaxCsv(rows);
    expect(taxCsv).toContain("Expense");
    expect(taxCsv).toContain("Income");
  });

  it("handles date-utils conversions and math", () => {
    const d = parseDate("2026-08-20");
    expect(isoDate(d)).toBe("2026-08-20");
    expect(addDays("2026-08-20", 5)).toBe("2026-08-25");
    expect(addMonths("2026-08-20", 1)).toBe("2026-09-20");

    const fallbackDate = parseDate("");
    expect(fallbackDate.getUTCFullYear()).toBe(1900);
    const partialDate = parseDate("2026");
    expect(partialDate.getUTCFullYear()).toBe(2026);
  });
});
