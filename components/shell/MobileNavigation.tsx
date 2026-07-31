"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type {
  AppShellActive,
  NavItemKey,
} from "@/components/shell/nav-model";
import {
  ArrowLeftRight,
  BarChart3,
  Compass,
  Landmark,
  LayoutDashboard,
  LineChart,
  Mail,
  Menu,
  PiggyBank,
  Repeat,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  X,
} from "@/components/ui/icons";

export interface MobileNavItem {
  key: NavItemKey;
  label: string;
  href: string;
  category: "primary" | "planning" | "manage";
  badge?: number;
}

const ICONS = {
  dashboard: LayoutDashboard,
  accounts: Landmark,
  transactions: Wallet,
  cashflow: ArrowLeftRight,
  reports: BarChart3,
  budget: PiggyBank,
  recurring: Repeat,
  goals: Target,
  investments: LineChart,
  forecasting: TrendingUp,
  advice: Compass,
  notifications: Mail,
  settings: Settings,
  wrapped: Sparkles,
} satisfies Record<NavItemKey, typeof LayoutDashboard>;

const QUICK_KEYS = new Set<NavItemKey>([
  "dashboard",
  "accounts",
  "transactions",
]);

const CATEGORY_LABELS: Record<MobileNavItem["category"], string> = {
  primary: "Money",
  planning: "Planning",
  manage: "Manage",
};

function resolvedActive(active: AppShellActive): NavItemKey {
  if (
    active === "overview" ||
    active === "monitor" ||
    active === "plan" ||
    active === "wealth"
  ) {
    return "dashboard";
  }
  return active;
}

function NavIcon({ itemKey }: Readonly<{ itemKey: NavItemKey }>) {
  const Icon = ICONS[itemKey];
  return <Icon aria-hidden className="h-4 w-4 shrink-0" />;
}

export default function MobileNavigation({
  items,
  active,
}: Readonly<{ items: MobileNavItem[]; active: AppShellActive }>) {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const activeKey = resolvedActive(active);
  const quickItems = items.filter((item) => QUICK_KEYS.has(item.key));
  const moreIsActive = !QUICK_KEYS.has(activeKey);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <nav
        aria-label="Primary"
        className="grid grid-cols-4 border-b border-panel-border bg-panel px-2 py-2 md:hidden"
      >
        {quickItems.map((item) => {
          const isActive = item.key === activeKey;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-field px-1 py-1.5 text-[0.7rem] font-semibold transition-colors focus-visible:outline-2",
                isActive
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-panel-hover hover:text-foreground",
              )}
            >
              <NavIcon itemKey={item.key} />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className={cn(
            "flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-field px-1 py-1.5 text-[0.7rem] font-semibold transition-colors focus-visible:outline-2",
            moreIsActive
              ? "bg-accent-soft text-accent"
              : "text-muted hover:bg-panel-hover hover:text-foreground",
          )}
        >
          <Menu aria-hidden className="h-4 w-4" />
          <span>More</span>
        </button>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end md:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close navigation"
            className="absolute inset-0 h-full w-full cursor-default bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="All navigation"
            aria-modal="true"
            className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-panel-border bg-panel p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-pop"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Navigate</p>
                <h2 className="mt-1 text-lg font-bold">All destinations</h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-panel-border bg-panel-2 text-muted hover:text-foreground focus-visible:outline-2"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-5">
              {(["primary", "planning", "manage"] as const).map((category) => {
                const categoryItems = items.filter(
                  (item) => item.category === category,
                );
                if (categoryItems.length === 0) return null;
                return (
                  <section key={category}>
                    <h3 className="eyebrow mb-2">
                      {CATEGORY_LABELS[category]}
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {categoryItems.map((item) => {
                        const isActive = item.key === activeKey;
                        return (
                          <Link
                            key={item.key}
                            href={item.href}
                            aria-current={isActive ? "page" : undefined}
                            onClick={() => setOpen(false)}
                            className={cn(
                              "flex min-h-12 min-w-0 items-center gap-3 rounded-field px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2",
                              isActive
                                ? "bg-accent-soft text-accent"
                                : "bg-panel-2 text-muted hover:bg-panel-hover hover:text-foreground",
                            )}
                          >
                            <NavIcon itemKey={item.key} />
                            <span className="min-w-0 truncate">
                              {item.label}
                            </span>
                            {!!item.badge && item.badge > 0 && (
                              <span className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-danger px-1 text-[0.6rem] font-bold text-white">
                                {item.badge > 9 ? "9+" : item.badge}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
