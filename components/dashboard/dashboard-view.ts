/** "overview" is the Phase 8 widget grid; the other three predate it. */
export type DashboardView = "overview" | "monitor" | "plan" | "wealth";

const VIEWS = new Set<DashboardView>(["overview", "monitor", "plan", "wealth"]);

/**
 * `defaultView` stays "monitor" so existing callers and bookmarked URLs behave
 * exactly as before. The dashboard passes "overview" only when the
 * `dashboardWidgets` flag is on, which is what makes the grid the landing view
 * without changing anyone's default mid-release.
 */
export function resolveDashboardView(
  {
    view,
    tab,
  }: {
    view?: string;
    tab?: string;
  },
  defaultView: DashboardView = "monitor",
): DashboardView {
  if (VIEWS.has(view as DashboardView)) {
    return view as DashboardView;
  }
  if (tab === "breakdowns" || tab === "cashflow") {
    return "wealth";
  }
  return defaultView;
}

export function dashboardHref({
  view,
  accountId,
  month,
}: {
  view: DashboardView;
  accountId?: string;
  month?: string;
}): string {
  const params = new URLSearchParams({ view });
  if (accountId) params.set("accountId", accountId);
  if (month) params.set("month", month);
  return `/dashboard?${params.toString()}`;
}

/**
 * Layers arbitrary extra query params onto a `/dashboard?...` href.
 *
 * Every dashboard filter chip (accounts, months, and now the ledger's own
 * account picker) needs to change one param while preserving whatever else
 * is active — item, drilldown, scope. One implementation, so they can't
 * drift into disagreeing about which params survive a click.
 */
export function withExtraParams(
  href: string,
  extraParams?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams(href.split("?")[1]);
  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (value) params.set(key, value);
  }
  return `/dashboard?${params.toString()}`;
}

/** Toolbar tab order. Overview only appears once the Phase 8 flag is on. */
export const DASHBOARD_VIEW_TABS: Record<"withOverview" | "legacy", readonly DashboardView[]> = {
  withOverview: ["overview", "monitor", "plan", "wealth"],
  legacy: ["monitor", "plan", "wealth"],
};
