import CustomizeDrawer from "@/components/dashboard/CustomizeDrawer";
import { normalizeWidgetPrefs } from "@/lib/dashboard-widgets";
import type { DashboardView } from "@/components/dashboard/dashboard-view";

/**
 * The page header's right-side action — Monarch's "Customize" white pill —
 * only makes sense next to the widget grid, so it renders only on the
 * Overview view. A tiny wrapper rather than inline page.tsx logic, so the
 * page stays under its enforced orchestrator line budget.
 */
export default function DashboardHeaderActions({
  activeView,
  prefsRaw,
}: Readonly<{ activeView: DashboardView; prefsRaw: unknown }>) {
  if (activeView !== "overview") return null;
  return <CustomizeDrawer initialPrefs={normalizeWidgetPrefs(prefsRaw)} />;
}
