import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let featureFlagMap: Record<string, boolean> = {
  settingsIa: true,
};

vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (flag: string) => featureFlagMap[flag] ?? true,
}));

vi.mock("@/components/shell/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    createElement("div", { "data-testid": "app-shell" }, children),
}));

vi.mock("@/components/shell/PageHeader", () => ({
  default: ({ title, description }: { title: string; description?: string }) =>
    createElement("header", { "data-testid": "page-header" }, title, description),
}));

vi.mock("@/components/settings/SettingsLayout", () => ({
  default: ({
    active,
    children,
  }: {
    active: string;
    children: React.ReactNode;
  }) =>
    createElement(
      "div",
      { "data-testid": "settings-layout", "data-active-section": active },
      children,
    ),
}));

vi.mock("@/components/settings/ProfileSection", () => ({
  default: () => createElement("div", { "data-testid": "profile-section" }),
}));

vi.mock("@/components/settings/DisplaySection", () => ({
  default: () => createElement("div", { "data-testid": "display-section" }),
}));

vi.mock("@/components/settings/DashboardPrefsSection", () => ({
  default: () => createElement("div", { "data-testid": "dashboard-prefs-section" }),
}));

vi.mock("@/components/settings/TagsSection", () => ({
  default: () => createElement("div", { "data-testid": "tags-section" }),
}));

vi.mock("@/components/settings/BanksSection", () => ({
  default: () => createElement("div", { "data-testid": "banks-section" }),
}));

vi.mock("@/components/settings/BudgetsSection", () => ({
  default: () => createElement("div", { "data-testid": "budgets-section" }),
}));

vi.mock("@/components/settings/MfaSection", () => ({
  default: () => createElement("div", { "data-testid": "mfa-section" }),
}));

vi.mock("@/components/settings/SessionsSection", () => ({
  default: () => createElement("div", { "data-testid": "sessions-section" }),
}));

vi.mock("@/components/settings/PasskeysSection", () => ({
  default: () => createElement("div", { "data-testid": "passkeys-section" }),
}));

vi.mock("@/components/settings/AuditLogSection", () => ({
  default: () => createElement("div", { "data-testid": "audit-log-section" }),
}));

vi.mock("@/components/settings/MerchantRulesSection", () => ({
  default: () => createElement("div", { "data-testid": "merchant-rules-section" }),
}));

vi.mock("@/components/settings/ManualAccountsSection", () => ({
  default: () => createElement("div", { "data-testid": "manual-accounts-section" }),
}));

vi.mock("@/components/settings/CategoryOverridesSection", () => ({
  default: () => createElement("div", { "data-testid": "category-overrides-section" }),
}));

vi.mock("@/components/settings/CalendarFeedSection", () => ({
  default: () => createElement("div", { "data-testid": "calendar-feed-section" }),
}));

vi.mock("@/components/settings/CardAprSection", () => ({
  default: () => createElement("div", { "data-testid": "card-apr-section" }),
}));

vi.mock("@/components/settings/ApiTokensSection", () => ({
  default: () => createElement("div", { "data-testid": "api-tokens-section" }),
}));

vi.mock("@/components/settings/SinkingFundsSection", () => ({
  default: () => createElement("div", { "data-testid": "sinking-funds-section" }),
}));

vi.mock("@/components/settings/AskAiSection", () => ({
  default: () => createElement("div", { "data-testid": "ask-ai-section" }),
}));

vi.mock("@/components/settings/ReceiptScanSection", () => ({
  default: () => createElement("div", { "data-testid": "receipt-scan-section" }),
}));

vi.mock("@/components/settings/SettleUpSection", () => ({
  default: () => createElement("div", { "data-testid": "settle-up-section" }),
}));

vi.mock("@/components/settings/CancelledSubscriptionsSection", () => ({
  default: () => createElement("div", { "data-testid": "cancelled-subscriptions-section" }),
}));

vi.mock("@/components/settings/ReconciliationSection", () => ({
  default: () => createElement("div", { "data-testid": "reconciliation-section" }),
}));

vi.mock("@/components/settings/HouseholdSection", () => ({
  default: () => createElement("div", { "data-testid": "household-section" }),
}));

vi.mock("@/components/settings/DangerZone", () => ({
  default: () => createElement("div", { "data-testid": "danger-zone" }),
}));

vi.mock("@/components/settings/DemoDataSection", () => ({
  default: () => createElement("div", { "data-testid": "demo-data-section" }),
}));

vi.mock("@/components/settings/ExportSection", () => ({
  default: () => createElement("div", { "data-testid": "export-section" }),
}));

vi.mock("@/components/settings/ImportSection", () => ({
  default: () => createElement("div", { "data-testid": "import-section" }),
}));

vi.mock("@/components/settings/ImportReviewSection", () => ({
  default: () => createElement("div", { "data-testid": "import-review-section" }),
}));

vi.mock("@/components/settings/MonarchConfigImportSection", () => ({
  default: () => createElement("div", { "data-testid": "monarch-config-import-section" }),
}));

vi.mock("@/components/settings/AiInsightsSection", () => ({
  default: () => createElement("div", { "data-testid": "ai-insights-section" }),
}));

vi.mock("@/lib/security-account", () => ({
  buildAuditLogPage: vi.fn().mockResolvedValue({ events: [], totalCount: 0, hasMore: false }),
  buildSessionList: vi.fn().mockResolvedValue({ currentSessionId: "s-1", sessions: [] }),
}));

vi.mock("@/lib/http", () => ({
  currentSessionId: vi.fn().mockResolvedValue("s-1"),
}));

vi.mock("@/lib/insights", () => ({
  suggestBudgets: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/sync-health", () => ({
  loadInstitutionObservability: vi.fn().mockResolvedValue({ institutions: [] }),
  SYNC_HEALTH_ITEM_COLUMNS: "id, institution_name",
}));

function createChainableQuery(resolvedData: unknown = []) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "neq", "order", "limit", "filter", "range", "in", "is"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: resolvedData });
  chain.single = vi.fn().mockResolvedValue({ data: resolvedData });
  chain.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data: resolvedData, error: null }).then(resolve);
  return chain;
}

let mockSupabase: ReturnType<typeof createMockSupabase>;

function createMockSupabase() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "test-user-id", email: "test@example.com" } },
      }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: "https://example.com/signed-avatar.png" },
        }),
      }),
    },
    rpc: vi.fn().mockResolvedValue({ data: [] }),
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "profiles") {
        return createChainableQuery({
          full_name: "Test User",
          display_name: "Tester",
          birthday: "1990-01-01",
          avatar_path: "avatars/test.png",
          display_prefs: {},
          dashboard_prefs: {},
        });
      }
      return createChainableQuery([]);
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(mockSupabase),
}));

import SettingsPage from "@/app/settings/page";

beforeEach(() => {
  featureFlagMap = { settingsIa: true };
  mockSupabase = createMockSupabase();
});

describe("SettingsPage Server Component", () => {
  it("renders profile section by default when settingsIa is true", async () => {
    const element = await SettingsPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="profile"');
    expect(html).toContain('data-testid="profile-section"');
  });

  it("redirects migration-dependent sections to institutions when settingsIa is false", async () => {
    featureFlagMap = { settingsIa: false };

    const element = await SettingsPage({
      searchParams: Promise.resolve({ section: "profile" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="institutions"');
    expect(html).toContain('data-testid="banks-section"');
  });

  it("handles string array searchParams safely using firstSearchParam", async () => {
    const element = await SettingsPage({
      searchParams: Promise.resolve({ section: ["display", "tags"] }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="display"');
    expect(html).toContain('data-testid="display-section"');
    expect(html).toContain('data-testid="dashboard-prefs-section"');
  });

  it("renders notifications section with links and reports", async () => {
    const element = await SettingsPage({
      searchParams: Promise.resolve({ section: "notifications" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="notifications"');
    expect(html).toContain("Open notifications");
  });

  it("renders tags section", async () => {
    const element = await SettingsPage({
      searchParams: Promise.resolve({ section: "tags" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="tags"');
    expect(html).toContain('data-testid="tags-section"');
  });

  it("renders rules section", async () => {
    const element = await SettingsPage({
      searchParams: Promise.resolve({ section: "rules" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="rules"');
    expect(html).toContain('data-testid="merchant-rules-section"');
  });

  it("renders categories section with overrides, budgets, and sinking funds", async () => {
    const element = await SettingsPage({
      searchParams: Promise.resolve({ section: "categories" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="categories"');
    expect(html).toContain('data-testid="category-overrides-section"');
    expect(html).toContain('data-testid="budgets-section"');
    expect(html).toContain('data-testid="sinking-funds-section"');
  });

  it("renders security section with MFA, sessions, passkeys, and audit log", async () => {
    const element = await SettingsPage({
      searchParams: Promise.resolve({ section: "security" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="security"');
    expect(html).toContain('data-testid="mfa-section"');
    expect(html).toContain('data-testid="sessions-section"');
    expect(html).toContain('data-testid="passkeys-section"');
    expect(html).toContain('data-testid="audit-log-section"');
  });

  it("renders integrations section with calendar, api tokens, ai-insights, and ask-ai", async () => {
    const element = await SettingsPage({
      searchParams: Promise.resolve({ section: "integrations" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="integrations"');
    expect(html).toContain('data-testid="calendar-feed-section"');
    expect(html).toContain('data-testid="ai-insights-section"');
    expect(html).toContain('data-testid="api-tokens-section"');
    expect(html).toContain('data-testid="ask-ai-section"');
  });

  it("renders merchants section with cancelled subscriptions", async () => {
    const element = await SettingsPage({
      searchParams: Promise.resolve({ section: "merchants" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="merchants"');
    expect(html).toContain('data-testid="cancelled-subscriptions-section"');
  });

  it("renders household-general and household-preferences sections", async () => {
    const genElement = await SettingsPage({
      searchParams: Promise.resolve({ section: "household-general" }),
    });
    const genHtml = renderToStaticMarkup(genElement);
    expect(genHtml).toContain('data-active-section="household-general"');
    expect(genHtml).toContain('data-testid="household-section"');

    const prefElement = await SettingsPage({
      searchParams: Promise.resolve({ section: "household-preferences" }),
    });
    const prefHtml = renderToStaticMarkup(prefElement);
    expect(prefHtml).toContain('data-active-section="household-preferences"');
  });

  it("renders data section with import, export, review, demo data, and danger zone", async () => {
    const element = await SettingsPage({
      searchParams: Promise.resolve({ section: "data" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="data"');
    expect(html).toContain('data-testid="export-section"');
    expect(html).toContain('data-testid="import-section"');
    expect(html).toContain('data-testid="import-review-section"');
    expect(html).toContain('data-testid="demo-data-section"');
    expect(html).toContain('data-testid="danger-zone"');
  });

  it("falls back to profile section on invalid or unknown section param", async () => {
    const element = await SettingsPage({
      searchParams: Promise.resolve({ section: "unknown-section-xyz" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="profile"');
    expect(html).toContain('data-testid="profile-section"');
  });

  it("passes page searchParam to audit log in security section", async () => {
    const element = await SettingsPage({
      searchParams: Promise.resolve({ section: "security", page: "2" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="security"');
    expect(html).toContain('data-testid="audit-log-section"');
  });

  it("handles empty user / unauthenticated state gracefully", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } });

    const element = await SettingsPage({
      searchParams: Promise.resolve({ section: "profile" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-section="profile"');
    expect(html).toContain('data-testid="profile-section"');
  });
});
