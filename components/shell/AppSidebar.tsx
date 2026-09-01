import Link from "next/link";
import { cn } from "@/lib/cn";
import { getEnabledNavItems, type AppShellActive, type NavItemDefinition } from "@/components/shell/nav-model";
import AskAiLowerRailLink from "@/components/shell/AskAiLowerRailLink";
import MobileNavigation from "@/components/shell/MobileNavigation";
import SidebarShell from "@/components/shell/SidebarShell";
import SidebarUtilityIcons from "@/components/shell/SidebarUtilityIcons";
import UserMenu from "@/components/shell/UserMenu";
import { createClient } from "@/lib/supabase/server";
import { countUnreviewedStreams } from "@/lib/recurring-page";
import { resolveDisplayName } from "@/lib/greeting";
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
    (item.key === "dashboard" &&
      ["overview", "monitor", "plan", "wealth"].includes(active));

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
          : "w-full px-3 py-2.5 md:justify-center md:px-0 lg:justify-start lg:px-3 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0",
        isActive
          ? "bg-accent-soft text-accent"
          : "text-muted hover:bg-panel-hover hover:text-foreground",
      )}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0" />
      <span
        className={
          compact
            ? ""
            : "md:sr-only lg:not-sr-only group-data-[collapsed=true]/sidebar:sr-only"
        }
      >
        {item.label}
      </span>
      {!!badge && badge > 0 && (
        <span
          aria-hidden
          className="ml-auto hidden h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.6rem] font-bold text-danger-foreground lg:flex group-data-[collapsed=true]/sidebar:hidden"
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}

export default async function AppSidebar({
  active,
  email,
  skeleton = false,
}: Readonly<{ active: AppShellActive; email?: string | null; skeleton?: boolean }>) {
  const enabledItems = getEnabledNavItems();

  const primaryItems = enabledItems.filter((i) => i.category === "primary");
  const planningItems = enabledItems.filter((i) => i.category === "planning");
  const manageItems = enabledItems.filter((i) => i.category === "manage");

  let initialCollapsed = false;
  let displayName = resolveDisplayName({ email });
  let avatarUrl: string | null = null;
  let unreviewedRecurringCount = 0;

  // A loading.tsx fallback (RouteSkeleton) mounts this same shell so
  // navigation never unmounts the frame, but it must paint instantly — so it
  // skips every Supabase round trip below and renders with the same
  // fallback values already used for a signed-out user. The real page
  // (skeleton=false) resolves collapse state, identity, and the recurring
  // badge count in one extra round trip, same as before.
  if (!skeleton) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("dashboard_prefs, display_name, full_name, avatar_path")
        .eq("id", user.id)
        .maybeSingle();
      const dashboardPrefs = (profile?.dashboard_prefs ?? {}) as DashboardPrefs;
      initialCollapsed = dashboardPrefs.sidebarCollapsed === true;
      displayName = resolveDisplayName({
        displayName: profile?.display_name as string | null,
        fullName: profile?.full_name as string | null,
        email,
      });
      if (profile?.avatar_path) {
        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrl(profile.avatar_path as string, 3600);
        avatarUrl = signed?.signedUrl ?? null;
      }

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
  }

  const badgeFor = (item: NavItemDefinition): number | undefined =>
    item.key === "recurring" ? unreviewedRecurringCount : undefined;

  return (
    <SidebarShell
      initialCollapsed={initialCollapsed}
      utilityIcons={<SidebarUtilityIcons />}
      bottomBlock={
        <div className="space-y-1">
          <AskAiLowerRailLink />
          <UserMenu displayName={displayName} email={email} avatarUrl={avatarUrl} />
        </div>
      }
      mobileNav={
        <MobileNavigation
          active={active}
          items={enabledItems.map((item) => ({
            key: item.key,
            label: item.label,
            href: item.href,
            category: item.category,
            badge: badgeFor(item),
          }))}
        />
      }
    >
      <nav aria-label="Primary" className="space-y-1">
        {primaryItems.map((item) => (
          <NavLink key={item.key} item={item} active={active} />
        ))}
        <p className="hidden px-3 pb-1 pt-4 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-muted lg:block group-data-[collapsed=true]/sidebar:hidden">
          Planning
        </p>
        {planningItems.map((item) => (
          <NavLink key={item.key} item={item} active={active} badge={badgeFor(item)} />
        ))}
        <p className="hidden px-3 pb-1 pt-4 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-muted lg:block group-data-[collapsed=true]/sidebar:hidden">
          Manage
        </p>
        {manageItems.map((item) => (
          <NavLink key={item.key} item={item} active={active} />
        ))}
      </nav>
    </SidebarShell>
  );
}
