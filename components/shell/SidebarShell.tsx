"use client";

import { useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";

/**
 * Owns only the collapse/expand chrome around the already-rendered nav
 * (children). Nav item resolution stays server-side in AppSidebar so
 * feature-flag env overrides keep working (see plan Task 6 design note).
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
  children,
  mobileNav,
  initialCollapsed = false,
}: Readonly<{ children: ReactNode; mobileNav: ReactNode; initialCollapsed?: boolean }>) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const supabase = createClient();

  async function toggle() {
    const next = !collapsed;
    setCollapsed(next);
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
    if (error) setCollapsed(!next);
  }

  return (
    <>
      <aside
        data-collapsed={collapsed}
        className={cn(
          "group/sidebar sticky top-16 hidden h-[calc(100vh-64px)] w-16 shrink-0 overflow-y-auto border-r border-panel-border bg-panel px-3 py-5 transition-[width] duration-150 md:block lg:px-4",
          collapsed ? "lg:w-16" : "lg:w-60",
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-pressed={collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="mb-3 hidden h-8 w-8 items-center justify-center rounded-field text-muted hover:bg-panel-hover hover:text-foreground focus-visible:outline-2 lg:inline-flex"
        >
          {collapsed ? (
            <ChevronRight aria-hidden className="h-4 w-4" />
          ) : (
            <ChevronLeft aria-hidden className="h-4 w-4" />
          )}
        </button>
        {children}
      </aside>
      {mobileNav}
    </>
  );
}
