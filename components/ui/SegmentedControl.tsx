import Link from "next/link";
import { cn } from "@/lib/cn";

export interface SegmentedControlItem {
  label: string;
  href: string;
  active: boolean;
}

/**
 * Link-based pill group in a recessed track, the active segment lifted onto
 * a `--panel` pill with a soft shadow — Monarch's Totals/Percent, Month/
 * Year/Decade, List/Calendar, Breakdown/Trends control. Replaces the three
 * divergent chip recipes this app had (MonthChips' solid-fill active state,
 * the account-filter chip's soft-fill active state, and ScopeChips'
 * borderless one) with a single one. Server-safe, like `Tabs` — every
 * option is a real URL, so the control's state is always shareable/
 * bookmarkable and needs no client JS.
 */
export default function SegmentedControl({
  items,
  ariaLabel,
}: Readonly<{ items: SegmentedControlItem[]; ariaLabel: string }>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-full bg-panel-2 p-1"
    >
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "inline-flex min-h-9 items-center justify-center rounded-full px-3.5 text-sm font-semibold transition-colors duration-150 focus-visible:outline-2",
            item.active
              ? "bg-panel text-foreground shadow-sm"
              : "text-muted hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
