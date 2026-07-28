import Link from "next/link";
import type { ComponentType } from "react";
import { cn } from "@/lib/cn";
import {
  FileText,
  LayoutDashboard,
  LineChart,
  Mail,
  PiggyBank,
  Settings,
  Sparkles,
  Target,
  Wallet,
} from "@/components/ui/icons";

export type AppShellActive =
  | "monitor"
  | "plan"
  | "wealth"
  | "transactions"
  | "goals"
  | "wrapped"
  | "reports"
  | "notifications"
  | "settings";

type NavItem = {
  label: string;
  href: string;
  key: AppShellActive;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

const primaryItems: NavItem[] = [
  { label: "Monitor", href: "/dashboard?view=monitor", key: "monitor", icon: LayoutDashboard },
  { label: "Plan", href: "/dashboard?view=plan", key: "plan", icon: PiggyBank },
  { label: "Wealth", href: "/dashboard?view=wealth", key: "wealth", icon: LineChart },
  { label: "Transactions", href: "/transactions", key: "transactions", icon: Wallet },
];

const manageItems: NavItem[] = [
  { label: "Goals", href: "/goals", key: "goals", icon: Target },
  { label: "Year in Money", href: "/wrapped", key: "wrapped", icon: Sparkles },
  { label: "Reports", href: "/settings#reports", key: "reports", icon: FileText },
  { label: "Notifications", href: "/notifications", key: "notifications", icon: Mail },
  { label: "Settings", href: "/settings", key: "settings", icon: Settings },
];

function NavLink({
  item,
  active,
  compact = false,
}: {
  item: NavItem;
  active: AppShellActive;
  compact?: boolean;
}) {
  const Icon = item.icon;
  const isActive = item.key === active;

  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-3 rounded-field text-sm font-semibold transition-colors duration-150 focus-visible:outline-2",
        compact ? "min-h-11 shrink-0 px-3 py-2" : "w-full px-3 py-2.5",
        isActive
          ? "bg-accent-soft text-accent"
          : "text-muted hover:bg-panel-hover hover:text-foreground",
      )}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0" />
      <span>{item.label}</span>
    </Link>
  );
}

export default function AppSidebar({ active }: { active: AppShellActive }) {
  const mobileItems = [...primaryItems, ...manageItems];

  return (
    <>
      <aside className="sticky top-16 hidden h-[calc(100vh-64px)] w-60 shrink-0 border-r border-panel-border bg-panel px-4 py-5 lg:block">
        <nav aria-label="Primary" className="space-y-1">
          {primaryItems.map((item) => (
            <NavLink key={item.key} item={item} active={active} />
          ))}
          <p className="px-3 pb-1 pt-6 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-muted">
            Manage
          </p>
          {manageItems.map((item) => (
            <NavLink key={item.key} item={item} active={active} />
          ))}
        </nav>
      </aside>
      <nav
        aria-label="Primary"
        className="lg:hidden flex gap-2 overflow-x-auto border-b border-panel-border px-4 py-3 scrollbar-none sm:px-6 [mask-image:linear-gradient(to_right,black_calc(100%_-_2rem),transparent)]"
      >
        {mobileItems.map((item) => (
          <NavLink key={item.key} item={item} active={active} compact />
        ))}
      </nav>
    </>
  );
}
