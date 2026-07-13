import Link from "next/link";
import type { ComponentType } from "react";
import { cn } from "@/lib/cn";
import {
  CreditCard,
  FileText,
  LayoutDashboard,
  LineChart,
  Mail,
  PiggyBank,
  Settings,
  Target,
  Wallet,
} from "@/components/ui/icons";

export type AppShellActive =
  | "overview"
  | "transactions"
  | "cards"
  | "cashflow"
  | "budgets"
  | "goals"
  | "reports"
  | "notifications"
  | "settings";

type NavItem = {
  label: string;
  href: string;
  key: AppShellActive;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

const navItems: NavItem[] = [
  { label: "Overview", href: "/dashboard", key: "overview", icon: LayoutDashboard },
  { label: "Transactions", href: "/transactions", key: "transactions", icon: Wallet },
  { label: "Cards & Banks", href: "/dashboard?tab=breakdowns", key: "cards", icon: CreditCard },
  { label: "Cash Flow Insights", href: "/dashboard?tab=cashflow", key: "cashflow", icon: LineChart },
  { label: "Budgets", href: "/settings#budgets", key: "budgets", icon: PiggyBank },
  { label: "Goals", href: "/goals", key: "goals", icon: Target },
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
        compact ? "shrink-0 px-3 py-2" : "w-full px-3 py-2.5",
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
  return (
    <>
      <aside className="sticky top-[73px] hidden h-[calc(100vh-73px)] w-64 shrink-0 border-r border-panel-border bg-background/80 px-4 py-5 backdrop-blur lg:block">
        <nav aria-label="Primary" className="space-y-1">
          {navItems.map((item) => (
            <NavLink key={item.key} item={item} active={active} />
          ))}
        </nav>
      </aside>
      <nav
        aria-label="Primary"
        className="lg:hidden -mx-4 flex gap-2 overflow-x-auto border-b border-panel-border px-4 py-3 scrollbar-none sm:-mx-6 sm:px-6"
      >
        {navItems.map((item) => (
          <NavLink key={item.key} item={item} active={active} compact />
        ))}
      </nav>
    </>
  );
}
