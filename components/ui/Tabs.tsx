import Link from "next/link";
import { cn } from "@/lib/cn";

/** Link-based underline tabs; server-safe, active state passed by the page. */
export default function Tabs({
  items,
  ariaLabel = "Tabs",
}: Readonly<{
  items: { label: string; href: string; active: boolean }[];
  ariaLabel?: string;
}>) {
  return (
    <nav
      aria-label={ariaLabel}
      className="flex gap-1 overflow-x-auto border-b border-panel-border scrollbar-none"
    >
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            // `min-h-11` (44px) to match Button/Input/SegmentedControl. Padding
            // plus the 2px underline only reached 42px, so every tab in the app
            // was two pixels under the touch-target bar.
            "-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-all duration-150 active:scale-[0.98] focus-visible:outline-2",
            item.active
              ? "border-accent text-foreground"
              : "border-transparent text-muted hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
