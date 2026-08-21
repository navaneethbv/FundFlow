import { describe, expect, it, vi } from "vitest";
import { getWeeklyReportData } from "@/lib/weekly-report-data";
import { isAllowedPushEndpoint, isPushConfigured, sendPushToUser } from "@/lib/push";
import { isAskAiAvailable } from "@/lib/ai-gate";
import { generateAiInsightSummaries } from "@/lib/ai-insights";
import { parseSinkingFundMutation, sinkingFundWrite } from "@/lib/sinking-funds";
import { parseDebtStrategy, parseExtraMonthly, loadDebtPlannerData } from "@/lib/debt-data";
import { syncCardAprsForUser } from "@/lib/liabilities";
import { shapeDailyAccountSnapshots, writeDailyAccountSnapshots } from "@/lib/account-history";
import * as aiProvider from "@/lib/ai-provider";
import paletteValidator from "@/scripts/validate_palette.js";
import { clientStub } from "../fixtures/supabase-query";

describe("Weekly Report Data Extra Branches", () => {
  it("returns null when user email is not found", async () => {
    const mockSupabase = {
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { email: null } },
            error: null,
          }),
        },
      },
    } as never;

    const period = {
      start: "2026-08-10",
      end: "2026-08-16",
      previousStart: "2026-08-03",
      previousEnd: "2026-08-09",
      label: "Aug 10 - Aug 16, 2026",
    };

    const res = await getWeeklyReportData(mockSupabase, "u-1", period);
    expect(res).toBeNull();
  });

  it("throws when auth query fails", async () => {
    const mockSupabase = {
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "User lookup failed" },
          }),
        },
      },
    } as never;

    const period = {
      start: "2026-08-10",
      end: "2026-08-16",
      previousStart: "2026-08-03",
      previousEnd: "2026-08-09",
      label: "Aug 10 - Aug 16, 2026",
    };

    await expect(getWeeklyReportData(mockSupabase, "u-1", period)).rejects.toThrow(
      "weekly report user: User lookup failed",
    );
  });

  it("handles empty transactions and splits", async () => {
    const mockSupabase = {
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { email: "alice@example.com" } },
            error: null,
          }),
        },
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    } as never;

    const period = {
      start: "2026-08-10",
      end: "2026-08-16",
      previousStart: "2026-08-03",
      previousEnd: "2026-08-09",
      label: "Aug 10 - Aug 16, 2026",
    };

    const res = await getWeeklyReportData(mockSupabase, "u-1", period);
    expect(res).not.toBeNull();
    expect(res?.totalSpend).toBe(0);
  });
});

describe("Push Notification Extra Branches", () => {
  it("validates allowed push endpoints strictly", () => {
    expect(isAllowedPushEndpoint("not-a-url")).toBe(false);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send")).toBe(false); // not https
    expect(isAllowedPushEndpoint("https://user:pass@fcm.googleapis.com/fcm/send")).toBe(false); // credentials
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8080/fcm/send")).toBe(false); // wrong port
    expect(isAllowedPushEndpoint("https://evil.internal.corp/push")).toBe(false); // unapproved host
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/123")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/123")).toBe(true);
  });

  it("handles push sending with 404/410 auto-prune and general errors", async () => {
    const origPub = process.env.VAPID_PUBLIC_KEY;
    const origPriv = process.env.VAPID_PRIVATE_KEY;
    try {
      process.env.VAPID_PUBLIC_KEY = "test-pub";
      process.env.VAPID_PRIVATE_KEY = "test-priv";
      expect(isPushConfigured()).toBe(true);

      const webpush = await import("web-push");
      vi.spyOn(webpush.default, "setVapidDetails").mockImplementation(() => {});
      vi.spyOn(webpush.default, "sendNotification")
        .mockRejectedValueOnce({ statusCode: 410 })
        .mockRejectedValueOnce({ statusCode: 500 });

      const service = await import("@/lib/supabase/service");
      const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
      vi.spyOn(service, "createServiceClient").mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { id: "sub-1", endpoint: "https://fcm.googleapis.com/1", p256dh: "key1", auth: "auth1" },
                { id: "sub-2", endpoint: "https://fcm.googleapis.com/2", p256dh: "key2", auth: "auth2" },
              ],
            }),
          }),
          delete: mockDelete,
        }),
      } as never);

      await sendPushToUser("u-1", { title: "Title", body: "Body" });
      expect(mockDelete).toHaveBeenCalled();
    } finally {
      process.env.VAPID_PUBLIC_KEY = origPub;
      process.env.VAPID_PRIVATE_KEY = origPriv;
    }
  });

  it("returns early when VAPID is not configured", async () => {
    const origPub = process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    expect(isPushConfigured()).toBe(false);
    await sendPushToUser("u-1", { title: "Title", body: "Body" });
    process.env.VAPID_PUBLIC_KEY = origPub;
  });
});

describe("AI Gate and AI Insights Branches", () => {
  it("checks AI availability with various consent matrix combinations", async () => {
    vi.spyOn(aiProvider, "isAiProviderConfigured").mockReturnValue(false);
    expect(await isAskAiAvailable({} as never, "u-1")).toBe(false);

    vi.spyOn(aiProvider, "isAiProviderConfigured").mockReturnValue(true);
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: table === "ai_settings" ? { enabled: true } : { ai_export_enabled: true },
            }),
          }),
        }),
      })),
    } as never;

    expect(await isAskAiAvailable(mockSupabase, "u-1")).toBe(true);

    const mockSupabaseDenied = {
      from: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: table === "ai_settings" ? { enabled: true } : { ai_export_enabled: false },
            }),
          }),
        }),
      })),
    } as never;
    expect(await isAskAiAvailable(mockSupabaseDenied, "u-1")).toBe(false);
  });

  it("generates AI insight summaries with diverse rows or disabled", () => {
    expect(generateAiInsightSummaries({ enabled: false, rows: [] })).toEqual([]);

    const emptyEnabled = generateAiInsightSummaries({
      enabled: true,
      rows: [],
    });
    expect(emptyEnabled[0]?.sourceMonth).toBeNull();
    expect(emptyEnabled[1]?.summary).toContain("spending");

    const nonNumberAmount = generateAiInsightSummaries({
      enabled: true,
      rows: [
        { amount: "bad" as never },
        { amount: -500 },
      ],
    });
    expect(nonNumberAmount[0]?.sourceMonth).toBeNull();

    const summaries = generateAiInsightSummaries({
      enabled: true,
      rows: [
        { month: "2026-08", amount: 150, category: null },
        { month: "2026-08", amount: -2000, category: "Income" },
        { amount: 50, category: "Dining" },
      ],
    });
    expect(summaries).toHaveLength(4);
    expect(summaries[0]?.sourceMonth).toBe("2026-08");
  });
});

describe("Sinking Funds Mutation Validator Branches", () => {
  it("validates all sinking fund mutation invalid branches", () => {
    expect(parseSinkingFundMutation(null)).toHaveProperty("error");
    expect(parseSinkingFundMutation({ name: "" })).toEqual({
      error: "name must be between 1 and 120 characters",
    });
    expect(parseSinkingFundMutation({ name: "Fund", targetAmount: -10 })).toEqual({
      error: "targetAmount must be a positive finite number",
    });
    expect(parseSinkingFundMutation({ name: "Fund", targetAmount: 500, dueDate: "2026-02-30" })).toEqual({
      error: "dueDate must be a valid YYYY-MM-DD date",
    });
    expect(parseSinkingFundMutation({ name: "Fund", targetAmount: 500, dueDate: "2026-12-31", cadence: "invalid" })).toEqual({
      error: "cadence is not supported",
    });
    expect(parseSinkingFundMutation({ name: "Fund", targetAmount: 500, dueDate: "2026-12-31", cadence: "custom", customIntervalMonths: 0 })).toEqual({
      error: "customIntervalMonths must be an integer from 1 to 120",
    });
    expect(parseSinkingFundMutation({ name: "Fund", targetAmount: 500, dueDate: "2026-12-31", cadence: "annual", customIntervalMonths: 3 })).toEqual({
      error: "customIntervalMonths is only valid for custom cadence",
    });

    const valid = parseSinkingFundMutation({
      name: "Taxes",
      targetAmount: 1200,
      dueDate: "2026-12-31",
      cadence: "custom",
      customIntervalMonths: 6,
    });
    expect(valid).toHaveProperty("value");
    if ("value" in valid) {
      expect(sinkingFundWrite(valid.value)).toEqual({
        name: "Taxes",
        target_amount: 1200,
        due_date: "2026-12-31",
        cadence: "custom",
        custom_interval_months: 6,
        cycle_anchor_date: "2026-12-31",
      });
    }
  });
});

describe("Debt Data and Liabilities Branches", () => {
  it("parses debt strategy and extra monthly", () => {
    expect(parseDebtStrategy("snowball")).toBe("snowball");
    expect(parseDebtStrategy(["avalanche"])).toBe("avalanche");
    expect(parseDebtStrategy(undefined)).toBe("avalanche");

    expect(parseExtraMonthly("100.50")).toBe(100.5);
    expect(parseExtraMonthly("abc")).toBe(0);
    expect(parseExtraMonthly(undefined)).toBe(0);
  });

  it("loads debt planner data with database error and non-liability filter", async () => {
    const client = clientStub({ accounts: { error: { code: "42P01" } } });

    await expect(
      loadDebtPlannerData(client as never, {
        scope: { kind: "mine", ownerUserId: "u-1" },
        extraMonthly: 0,
      }),
    ).rejects.toThrow("debt_accounts_query_failed:42P01");
  });

  it("syncCardAprsForUser handles disabled liabilities or Plaid product errors", async () => {
    const orig = process.env.PLAID_LIABILITIES_ENABLED;
    try {
      process.env.PLAID_LIABILITIES_ENABLED = "0";
      expect(await syncCardAprsForUser("u-1")).toBe(0);

      process.env.PLAID_LIABILITIES_ENABLED = "1";
      const plaidModule = await import("@/lib/plaid");
      vi.spyOn(plaidModule, "getPlaidClient").mockReturnValue({
        liabilitiesGet: vi.fn().mockResolvedValue({
          data: {
            liabilities: {
              credit: [
                { account_id: "acc-1", aprs: [{ apr_type: "purchase_apr", apr_percentage: 19.99 }] },
                { account_id: "", aprs: [] },
                { account_id: "acc-2", aprs: [{ apr_type: "cash_advance", apr_percentage: 25.99 }] },
                { account_id: "acc-3", aprs: null as never },
                { account_id: "acc-4", aprs: [{ apr_type: "purchase_apr", apr_percentage: null }] },
              ],
            },
          },
        }),
      } as never);

      const plaidService = await import("@/lib/plaid-service");
      vi.spyOn(plaidService, "listActiveItems").mockResolvedValue([{ id: "item-1" }] as never);
      vi.spyOn(plaidService, "decryptItemToken").mockReturnValue("access-token");

      const service = await import("@/lib/supabase/service");
      vi.spyOn(service, "createServiceClient").mockReturnValue({
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      } as never);

      const updated = await syncCardAprsForUser("u-1");
      expect(updated).toBe(1);

      // Update returns error
      vi.spyOn(service, "createServiceClient").mockReturnValue({
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: { message: "Update failed" } }),
            }),
          }),
        }),
      } as never);
      expect(await syncCardAprsForUser("u-1")).toBe(0);

      // Null liabilities and catch block
      vi.spyOn(plaidModule, "getPlaidClient").mockReturnValueOnce({
        liabilitiesGet: vi.fn().mockResolvedValue({
          data: { liabilities: null },
        }),
      } as never);
      expect(await syncCardAprsForUser("u-1")).toBe(0);

      vi.spyOn(plaidModule, "getPlaidClient").mockReturnValueOnce({
        liabilitiesGet: vi.fn().mockRejectedValue(new Error("Plaid API offline")),
      } as never);
      expect(await syncCardAprsForUser("u-1")).toBe(0);
    } finally {
      process.env.PLAID_LIABILITIES_ENABLED = orig;
    }
  });
});

describe("validate_palette Script Branches", () => {
  it("validates hexToRgb, deltaEOklab, and palette validation failures", () => {
    expect(() => paletteValidator.hexToRgb("invalid")).toThrow("invalid_hex_color");
    expect(paletteValidator.hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });

    const sim = paletteValidator.simulateCvd({ r: 200, g: 100, b: 50 }, "protanopia");
    expect(sim.r).toBeGreaterThan(0);

    const distance = paletteValidator.deltaEOklab("#ffffff", "#000000");
    expect(distance).toBeGreaterThan(50);

    // Fail normal floor by giving duplicate or near-duplicate colors
    const invalidPalette = ["#ff0000", "#ff0001", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff"];
    const validation = paletteValidator.validatePalette("light", invalidPalette);
    expect(validation.valid).toBe(false);
    expect(validation.failures.length).toBeGreaterThan(0);
  });

  it("handles CLI with missing/invalid css and valid css", async () => {
    const cssWithMissingTheme = ":root { --viz-1: #112233; }";
    const palettes = paletteValidator.palettesFromCss(cssWithMissingTheme);
    expect(Object.keys(palettes).length).toBe(0);

    const code = await paletteValidator.runCli("app/globals.css");
    expect(code).toBe(0);

    const failCode = await paletteValidator.runCli("package.json");
    expect(failCode).toBe(1);
  });
});

describe("Account History Deep Branches", () => {
  it("validates empty or non-numeric balances in shapeDailyAccountSnapshots", () => {
    expect(() =>
      shapeDailyAccountSnapshots({
        userId: "u-1",
        snapshotDate: "2026-08-01",
        plaidAccounts: [
          { id: "a1", current_balance: "   ", available_balance: null, iso_currency_code: "USD" },
        ],
        manualAccounts: [],
      }),
    ).toThrow("Balance must be numeric");

    expect(() =>
      shapeDailyAccountSnapshots({
        userId: "u-1",
        snapshotDate: "2026-08-01",
        plaidAccounts: [
          { id: "a1", current_balance: "NaN", available_balance: null, iso_currency_code: "USD" },
        ],
        manualAccounts: [],
      }),
    ).toThrow("Balance must be finite");
  });

  it("handles writeDailyAccountSnapshots empty rows and manual error", async () => {
    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "accounts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          };
        }
        if (table === "manual_accounts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: new Error("Manual db error") }),
            }),
          };
        }
        return {};
      }),
    } as never);

    await expect(writeDailyAccountSnapshots("u-1", "2026-08-01")).rejects.toThrow("Manual db error");

    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      })),
    } as never);

    const result = await writeDailyAccountSnapshots("u-1", "2026-08-01");
    expect(result.written).toBe(0);
  });
});


