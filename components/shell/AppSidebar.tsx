import Link from "next/link";
import { cn } from "@/lib/cn";
import { getEnabledNavItems, type AppShellActive, type NavItemDefinition } from "@/components/shell/nav-model";
import AskAiLowerRailLink from "@/components/shell/AskAiLowerRailLink";
import SidebarShell from "@/components/shell/SidebarShell";
import { createClient } from "@/lib/supabase/server";
import { countUnreviewedStreams } from "@/lib/recurring-page";
import type { DashboardPrefs } from "@/components/settings/DashboardPrefsSection";

export type { AppShellActive };

function NavLink({
  item,
  active,
  compact = false,
  badge,
}: Readonly<{
  item: NavItemDefinition;
  active: AppShellActive;
  compact?: boolean;
  badge?: number;
}>) {
  const Icon = item.icon;
  const isActive =
    item.key === active ||
    (item.key === "dashboard" && ["monitor", "plan", "wealth"].includes(active));

  return (
    <Link
      href={item.href}
      title={item.label}
      aria-label={badge && badge > 0 ? `${item.label}, ${badge} to review` : undefined}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-3 rounded-field text-sm font-semibold transition-colors duration-150 focus-visible:outline-2",
        compact
          ? "min-h-11 shrink-0 px-3 py-2"
          : "w-full px-3 py-2.5 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0",
        isActive
          ? "bg-accent-soft text-accent"
          : "text-muted hover:bg-panel-hover hover:text-foreground",
      )}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0" />
      <span className={compact ? "" : "group-data-[collapsed=true]/sidebar:sr-only"}>{item.label}</span>
      {!!badge && badge > 0 && (
        <span
          aria-hidden
          className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.6rem] font-bold text-white group-data-[collapsed=true]/sidebar:hidden"
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}

export default async function AppSidebar({ active }: Readonly<{ active: AppShellActive }>) {
  const enabledItems = getEnabledNavItems();

  const primaryItems = enabledItems.filter((i) => i.category === "primary");
  const planningItems = enabledItems.filter((i) => i.category === "planning");
  const manageItems = enabledItems.filter((i) => i.category === "manage");

  // Resolve the persisted collapse state server-side so SidebarShell can
  // seed its initial render correctly, instead of flashing expanded and
  // then animating shut on every page load (Task 6 review finding #2).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let initialCollapsed = false;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("dashboard_prefs")
      .eq("id", user.id)
      .maybeSingle();
    const dashboardPrefs = (profile?.dashboard_prefs ?? {}) as DashboardPrefs;
    initialCollapsed = dashboardPrefs.sidebarCollapsed === true;
  }

  let unreviewedRecurringCount = 0;
  if (user) {
    const { data: reviewRows } = await supabase
      .from("recurring_streams")
      .select("is_active,status,dismissed_at,reviewed_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .eq("status", "MATURE")
      .is("dismissed_at", null)
      .is("reviewed_at", null);
    unreviewedRecurringCount = countUnreviewedStreams(
      (reviewRows ?? []).map((row) => ({
        isActive: row.is_active,
        status: row.status,
        dismissedAt: row.dismissed_at,
        reviewedAt: row.reviewed_at,
      })),
    );
  }

  const badgeFor = (item: NavItemDefinition): number | undefined =>
    item.key === "recurring" ? unreviewedRecurringCount : undefined;

  return (
    <SidebarShell
      initialCollapsed={initialCollapsed}
      mobileNav={
        <nav
          aria-label="Primary"
          className="lg:hidden flex gap-2 overflow-x-auto border-b border-panel-border px-4 py-3 scrollbar-none sm:px-6 [mask-image:linear-gradient(to_right,black_calc(100%_-_2rem),transparent)]"
        >
          {enabledItems.map((item) => (
            <NavLink key={item.key} item={item} active={active} compact badge={badgeFor(item)} />
          ))}
        </nav>
      }
    >
      <nav aria-label="Primary" className="space-y-1">
        {primaryItems.map((item) => (
          <NavLink key={item.key} item={item} active={active} />
        ))}
        <p className="px-3 pb-1 pt-4 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-muted group-data-[collapsed=true]/sidebar:hidden">
          Planning
        </p>
        {planningItems.map((item) => (
          <NavLink key={item.key} item={item} active={active} badge={badgeFor(item)} />
        ))}
        <p className="px-3 pb-1 pt-4 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-muted group-data-[collapsed=true]/sidebar:hidden">
          Manage
        </p>
        {manageItems.map((item) => (
          <NavLink key={item.key} item={item} active={active} />
        ))}
        <AskAiLowerRailLink />
      </nav>
    </SidebarShell>
  );
}
