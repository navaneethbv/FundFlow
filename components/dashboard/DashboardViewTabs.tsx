import Tabs from "@/components/ui/Tabs";
import {
  DASHBOARD_VIEW_TABS,
  type DashboardView,
} from "@/components/dashboard/dashboard-view";

/**
 * The dashboard's view switcher. Lifted out of the page so adding a view is a
 * change here rather than more JSX in the orchestrator.
 */
export default function DashboardViewTabs({
  activeView,
  withOverview,
  hrefFor,
}: Readonly<{
  activeView: DashboardView;
  withOverview: boolean;
  hrefFor: (view: DashboardView) => string;
}>) {
  return (
    <Tabs
      items={DASHBOARD_VIEW_TABS[withOverview ? "withOverview" : "legacy"].map(
        (view) => ({
          label: view[0]!.toUpperCase() + view.slice(1),
          href: hrefFor(view),
          active: activeView === view,
        }),
      )}
    />
  );
}
