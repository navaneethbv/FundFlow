"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { writeSidebarCollapsedCookie } from "@/lib/sidebar-collapsed-cookie";
import { cn } from "@/lib/cn";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { LogoMark } from "@/components/ui/Logo";

const subscribeToHydration = () => () => undefined;

/**
 * Owns the collapse/expand chrome and the three-region layout (logo +
 * utilities pinned at top, nav scrolling in the middle, the Ask-AI link and
 * account menu pinned at the bottom) around the already-resolved pieces
 * passed in. Nav item resolution and the account/utility data all stay
 * server-side in AppSidebar so feature-flag env overrides and the signed
 * avatar URL keep working (see plan Task 6 design note for the same
 * reasoning applied to collapse state).
 *
 * Full height now that there is no separate top bar above it — Monarch's
 * sidebar runs edge to edge, and folding the old top bar's utility icons
 * and account controls in here is what let that bar disappear.
 *
 * Persists to profiles.dashboard_prefs.sidebarCollapsed, the same
 * client-writable column DashboardPrefsSection already uses, so the choice
 * follows the user across devices.
 *
 * The initial collapse state is resolved server-side by AppSidebar and
 * passed in as `initialCollapsed`, rather than fetched here on mount: a
 * client-side fetch-then-setState would flash the sidebar expanded before
 * collapsing on every page load for users who collapsed it.
 */
export default function SidebarShell({
  utilityIcons,
  bottomBlock,
  children,
  mobileNav,
  initialCollapsed = false,
}: Readonly<{
  utilityIcons: ReactNode;
  bottomBlock: ReactNode;
  children: ReactNode;
  mobileNav: ReactNode;
  initialCollapsed?: boolean;
}>) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const supabase = createClient();

  async function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    writeSidebarCollapsedCookie(next);
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("dashboard_prefs")
      .eq("id", data.user.id)
      .maybeSingle();
    const dashboardPrefs =
      profile?.dashboard_prefs &&
      typeof profile.dashboard_prefs === "object" &&
      !Array.isArray(profile.dashboard_prefs)
        ? profile.dashboard_prefs
        : {};
    const { error } = await supabase
      .from("profiles")
      .update({ dashboard_prefs: { ...dashboardPrefs, sidebarCollapsed: next } })
      .eq("id", data.user.id);
    // Revert the optimistic toggle if the write failed, so the UI never
    // claims a collapse state that wasn't actually persisted.
    if (error) {
      setCollapsed(!next);
      writeSidebarCollapsedCookie(!next);
    }
  }

  return (
    <>
      <aside
        data-collapsed={collapsed}
        className={cn(
          "group/sidebar sticky top-0 hidden h-screen w-16 shrink-0 flex-col border-r border-panel-border bg-panel transition-[width] duration-200 ease-in-out md:flex",
          collapsed ? "lg:w-16" : "lg:w-60",
        )}
      >
        <div className="shrink-0 px-3 py-5 lg:px-4">
          <Link
            href="/dashboard"
            aria-label="FundFlow, dashboard"
            className="mb-3 flex items-center gap-2.5 rounded-field px-1 transition-transform duration-150 active:scale-95 focus-visible:outline-2 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0"
          >
            <LogoMark className="h-8 w-8 shrink-0" />
            <span className="text-base font-bold tracking-tight md:sr-only lg:not-sr-only group-data-[collapsed=true]/sidebar:sr-only">
              FundFlow
            </span>
          </Link>

          <div className="mb-1">{utilityIcons}</div>

          <button
            type="button"
            disabled={!hydrated}
            onClick={toggle}
            aria-pressed={collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden h-8 w-8 items-center justify-center rounded-field text-muted transition-all duration-150 hover:bg-panel-hover hover:text-foreground active:scale-95 focus-visible:outline-2 lg:inline-flex"
          >
            {collapsed ? (
              <ChevronRight aria-hidden className="h-4 w-4" />
            ) : (
              <ChevronLeft aria-hidden className="h-4 w-4" />
            )}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 lg:px-4">
          {children}
        </div>

        <div className="shrink-0 border-t border-panel-border px-3 py-3 lg:px-4">
          {bottomBlock}
        </div>
      </aside>
      {mobileNav}
    </>
  );
}
