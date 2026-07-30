import Link from "next/link";
import { cn } from "@/lib/cn";
import { getEnabledNavItems, type AppShellActive, type NavItemDefinition } from "@/components/shell/nav-model";
import AskAiLowerRailLink from "@/components/shell/AskAiLowerRailLink";
import SidebarShell from "@/components/shell/SidebarShell";

export type { AppShellActive };

function NavLink({
  item,
  active,
  compact = false,
}: Readonly<{
  item: NavItemDefinition;
  active: AppShellActive;
  compact?: boolean;
}>) {
  const Icon = item.icon;
  const isActive =
    item.key === active ||
    (item.key === "dashboard" && ["monitor", "plan", "wealth"].includes(active));

  return (
    <Link
      href={item.href}
      title={item.label}
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
      <span className={compact ? "" : "group-data-[collapsed=true]/sidebar:sr-only"}>{item.label}</span>
    </Link>
  );
}

export default function AppSidebar({ active }: Readonly<{ active: AppShellActive }>) {
  const enabledItems = getEnabledNavItems();

  const primaryItems = enabledItems.filter((i) => i.category === "primary");
  const planningItems = enabledItems.filter((i) => i.category === "planning");
  const manageItems = enabledItems.filter((i) => i.category === "manage");

  return (
    <SidebarShell
      mobileNav={
        <nav
          aria-label="Primary"
          className="lg:hidden flex gap-2 overflow-x-auto border-b border-panel-border px-4 py-3 scrollbar-none sm:px-6 [mask-image:linear-gradient(to_right,black_calc(100%_-_2rem),transparent)]"
        >
          {enabledItems.map((item) => (
            <NavLink key={item.key} item={item} active={active} compact />
          ))}
        </nav>
      }
    >
      <nav aria-label="Primary" className="space-y-1">
        {primaryItems.map((item) => (
          <NavLink key={item.key} item={item} active={active} />
        ))}
        <p className="px-3 pb-1 pt-4 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-muted">
          Planning
        </p>
        {planningItems.map((item) => (
          <NavLink key={item.key} item={item} active={active} />
        ))}
        <p className="px-3 pb-1 pt-4 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-muted">
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
