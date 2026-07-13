export type DashboardView = "monitor" | "plan" | "wealth";

export function resolveDashboardView({
  view,
  tab,
}: {
  view?: string;
  tab?: string;
}): DashboardView {
  if (view === "monitor" || view === "plan" || view === "wealth") {
    return view;
  }
  if (tab === "breakdowns" || tab === "cashflow") {
    return "wealth";
  }
  return "monitor";
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
