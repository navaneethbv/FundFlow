"use client";

import { useEffect, useState, type ReactNode } from "react";
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
 */
export default function SidebarShell({
  children,
  mobileNav,
}: Readonly<{ children: ReactNode; mobileNav: ReactNode }>) {
  const [collapsed, setCollapsed] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("dashboard_prefs")
        .eq("id", data.user.id)
        .maybeSingle();
      if (active && profile?.dashboard_prefs?.sidebarCollapsed === true) {
        setCollapsed(true);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    await supabase
      .from("profiles")
      .update({ dashboard_prefs: { ...(profile?.dashboard_prefs ?? {}), sidebarCollapsed: next } })
      .eq("id", data.user.id);
  }

  return (
    <>
      <aside
        data-collapsed={collapsed}
        className={cn(
          "group/sidebar sticky top-16 hidden h-[calc(100vh-64px)] shrink-0 border-r border-panel-border bg-panel px-4 py-5 lg:block overflow-y-auto transition-[width] duration-150",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-pressed={collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-field text-muted hover:bg-panel-hover hover:text-foreground focus-visible:outline-2"
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
