import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  completedOnboardingCount,
  mergeOnboardingPrefs,
  onboardingTourIndex,
  parseOnboardingPrefs,
  type OnboardingStatus,
} from "@/lib/onboarding";
import { hasSeenReleaseHighlights, RELEASE_HIGHLIGHTS_VERSION } from "@/lib/release-highlights";
import { loadOnboardingPageData } from "@/lib/onboarding-data";
import { loadPaydaySettings } from "@/lib/payday-data";

vi.mock("@/lib/payday-data", () => ({ loadPaydaySettings: vi.fn() }));

const status: OnboardingStatus = {
  connectBank: true,
  confirmPayday: false,
  seedBudget: true,
  chooseAlerts: false,
  enableMfa: false,
};

describe("onboarding preferences", () => {
  it("parses only safe, resumable values", () => {
    expect(parseOnboardingPrefs({ dismissed: true, tourStep: 2, ignored: "x" })).toEqual({ dismissed: true, tourStep: 2 });
    expect(parseOnboardingPrefs({ dismissed: "yes", tourStep: -1 })).toEqual({ dismissed: false });
  });

  it("merges into dashboard preferences without dropping sibling settings", () => {
    expect(mergeOnboardingPrefs({ sidebarCollapsed: true, widgets: { hidden: ["goals"] } }, { dismissed: true })).toEqual({
      sidebarCollapsed: true,
      widgets: { hidden: ["goals"] },
      onboarding: { dismissed: true },
    });
  });

  it("counts progress and resumes on the first incomplete step", () => {
    expect(completedOnboardingCount(status)).toBe(2);
    expect(onboardingTourIndex({}, status)).toBe(1);
    expect(onboardingTourIndex({ tourStep: 99 }, status)).toBe(4);
  });
});

describe("release highlights", () => {
  it("requires the current version marker", () => {
    expect(hasSeenReleaseHighlights({ releaseHighlightsSeen: RELEASE_HIGHLIGHTS_VERSION })).toBe(true);
    expect(hasSeenReleaseHighlights({ releaseHighlightsSeen: "old" })).toBe(false);
  });
});

describe("onboarding page data", () => {
  beforeEach(() => {
    vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "");
    vi.mocked(loadPaydaySettings).mockReset();
  });

  function clientFor(rows: Record<string, unknown>) {
    return {
      from(table: string) {
        const data = rows[table] ?? [];
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq", "limit"]) {
          chain[method] = vi.fn().mockReturnValue(chain);
        }
        chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
        chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
        return chain;
      },
    } as never;
  }

  it("derives bounded completion state without reading transaction rows", async () => {
    const data = await loadOnboardingPageData(clientFor({
      profiles: { dashboard_prefs: { onboarding: { dismissed: true, tourStep: 3 } }, mfa_enrolled: true },
      plaid_items: [{ id: "item" }],
      budgets: [{ id: "budget" }],
      alert_preferences: { user_id: "user" },
    }), "user");
    expect(data.status).toEqual({ connectBank: true, confirmPayday: false, seedBudget: true, chooseAlerts: true, enableMfa: true });
    expect(data.prefs).toEqual({ dismissed: true, tourStep: 3 });
    expect(data.steps.find((step) => step.key === "confirmPayday")).toMatchObject({ available: false, complete: false });
    expect(loadPaydaySettings).not.toHaveBeenCalled();
  });

  it("uses the confirmed payday when the payday release is enabled", async () => {
    vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "paydaySettings");
    vi.mocked(loadPaydaySettings).mockResolvedValue({
      cadence: "monthly",
      anchorDate: "2026-10-15",
      amount: 5000,
      day1: 15,
      day2: null,
    });
    const data = await loadOnboardingPageData(clientFor({ profiles: {}, plaid_items: [], budgets: [], alert_preferences: null }), "user");
    expect(data.status.confirmPayday).toBe(true);
    expect(data.steps.find((step) => step.key === "confirmPayday")).toMatchObject({ available: true, complete: true });
    expect(loadPaydaySettings).toHaveBeenCalledWith(expect.anything(), "user");
  });
});
