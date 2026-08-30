import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as cronWeeklyReportGet } from "@/app/api/cron/weekly-report/route";
import { runWeeklyReports } from "@/lib/weekly-report-runner";
import { loadDebtPlannerData } from "@/lib/debt-data";
import { clientStub } from "../fixtures/supabase-query";
import * as http from "@/lib/http";
import * as cronAlert from "@/lib/cron-alert";
import * as weeklyData from "@/lib/weekly-report-data";
import * as reportDelivery from "@/lib/report-delivery";
import * as reportPeriod from "@/lib/report-period";
import * as reportPdf from "@/lib/report-pdf";

describe("Cron Weekly Report Deep Branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips undeliverable recipient in runWeeklyReports", async () => {
    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ id: "u-1", timezone: "America/New_York" }],
              error: null,
            }),
          }),
        }),
      }),
    } as never);

    vi.spyOn(reportPeriod, "isWeeklyReportDue").mockReturnValue(true);
    vi.spyOn(reportDelivery, "claimWeeklyDelivery").mockResolvedValue({
      claimed: true,
      deliveryId: "del-1",
    });
    vi.spyOn(weeklyData, "getWeeklyReportData").mockResolvedValue({
      userEmail: "test@example.invalid", // undeliverable domain
      userName: "Tester",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-07",
    } as never);
    vi.spyOn(reportDelivery, "markWeeklyDeliverySkipped").mockResolvedValue();

    const result = await runWeeklyReports(new Date(), ["u-1"]);
    expect(result.reports_skipped).toBe(1);
  });

  it("handles PDF render failure in runWeeklyReports", async () => {
    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ id: "u-1", timezone: "America/New_York" }],
              error: null,
            }),
          }),
        }),
      }),
    } as never);

    vi.spyOn(reportPeriod, "isWeeklyReportDue").mockReturnValue(true);
    vi.spyOn(reportDelivery, "claimWeeklyDelivery").mockResolvedValue({
      claimed: true,
      deliveryId: "del-1",
    });
    vi.spyOn(weeklyData, "getWeeklyReportData").mockResolvedValue({
      userEmail: "user@fundflow.app",
      userName: "Tester",
    } as never);
    vi.spyOn(reportPdf, "generateWeeklyReportPdf").mockRejectedValue(new Error("PDF boom"));
    vi.spyOn(reportDelivery, "markWeeklyDeliveryFailed").mockResolvedValue();

    const result = await runWeeklyReports(new Date(), ["u-1"]);
    expect(result.reports_failed).toBe(1);
    expect(result.first_error).toBe("pdf_render_failed");
  });

  it("triggers alertCronFailure in GET when reports fail", async () => {
    vi.spyOn(http, "requireCronAuth").mockReturnValue(null);
    const alertSpy = vi.spyOn(cronAlert, "alertCronFailure").mockResolvedValue();

    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: "u-1", timezone: "America/New_York" }],
            error: null,
          }),
        }),
      }),
    } as never);

    vi.spyOn(reportPeriod, "isWeeklyReportDue").mockReturnValue(true);
    vi.spyOn(reportDelivery, "claimWeeklyDelivery").mockResolvedValue({
      claimed: true,
      deliveryId: "del-1",
    });
    vi.spyOn(weeklyData, "getWeeklyReportData").mockResolvedValue(null); // missing email
    vi.spyOn(reportDelivery, "markWeeklyDeliveryFailed").mockResolvedValue();

    const req = new NextRequest("http://localhost/api/cron/weekly-report");
    const res = await cronWeeklyReportGet(req);
    expect(res.status).toBe(200);
    expect(alertSpy).toHaveBeenCalled();
  });

  it("handles profile query error and non-Error throw in GET", async () => {
    vi.spyOn(http, "requireCronAuth").mockReturnValue(null);
    const alertSpy = vi.spyOn(cronAlert, "alertCronFailure").mockResolvedValue();

    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: new Error("Database offline"),
          }),
        }),
      }),
    } as never);

    await expect(runWeeklyReports()).rejects.toThrow("Database offline");

    // Profiles is null, isWeeklyReportDue is false, claimWeeklyDelivery throws error
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: null, // null profiles
            error: null,
          }),
        }),
      }),
    } as never);

    const nullProfRes = await runWeeklyReports();
    expect(nullProfRes.users).toBe(0);

    // Profile where report is not due
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: "u-not-due", timezone: "America/New_York" }],
            error: null,
          }),
        }),
      }),
    } as never);
    vi.spyOn(reportPeriod, "isWeeklyReportDue").mockReturnValue(false);
    const notDueRes = await runWeeklyReports();
    expect(notDueRes.due).toBe(0);

    // claimWeeklyDelivery throws before deliveryId created
    vi.spyOn(reportPeriod, "isWeeklyReportDue").mockReturnValue(true);
    vi.spyOn(reportDelivery, "claimWeeklyDelivery").mockRejectedValue(new Error("Claim failed"));
    const claimFailRes = await runWeeklyReports();
    expect(claimFailRes.reports_failed).toBe(1);

    // Test non-Error thrown in GET
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockImplementation(() => {
        throw "String error occurred for test@secret.com";
      }),
    } as never);

    const req = new NextRequest("http://localhost/api/cron/weekly-report");
    const res = await cronWeeklyReportGet(req);
    expect(res.status).toBe(500);
    expect(alertSpy).toHaveBeenCalled();
  });
});

describe("Debt Data Household and Error Code Branches", () => {
  it("queries accounts without userId filter and handles error codes", async () => {
    // Household scope (userId is null)
    const client = clientStub({
      accounts: {
        data: [
          {
            id: "card-1",
            name: null, // tests fallback name "Debt"
            type: "credit",
            subtype: "credit card",
            current_balance: null, // tests fallback balance 0
            apr: 18.5,
          },
        ],
      },
    });

    const data = await loadDebtPlannerData(client as never, {
      scope: { kind: "household", householdId: "h-1" },
      extraMonthly: 100,
    });
    expect(data.debts).toEqual([]);

    // Error with error code
    const clientError = clientStub({
      accounts: {
        error: { code: "42P01", message: "Table does not exist" },
      },
    });

    await expect(
      loadDebtPlannerData(clientError as never, {
        scope: { kind: "mine", ownerUserId: "u-1" },
        extraMonthly: 0,
      }),
    ).rejects.toThrow("debt_accounts_query_failed:42P01");

    // Error without error code
    const clientErrorNoCode = clientStub({
      accounts: {
        error: { message: "Table does not exist" },
      },
    });
    await expect(
      loadDebtPlannerData(clientErrorNoCode as never, {
        scope: { kind: "mine", ownerUserId: "u-1" },
        extraMonthly: 0,
      }),
    ).rejects.toThrow("debt_accounts_query_failed");

    // Null data and null type and null apr
    const clientNullData = clientStub({
      accounts: {
        data: null,
      },
    });
    const nullDataRes = await loadDebtPlannerData(clientNullData as never, {
      scope: { kind: "mine", ownerUserId: "u-1" },
      extraMonthly: 0,
    });
    expect(nullDataRes.debts).toEqual([]);
  });
});
