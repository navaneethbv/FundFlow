import Link from "next/link";
import { cn } from "@/lib/cn";

/** Link-based underline tabs; server-safe, active state passed by the page. */
export default function Tabs({
  items,
}: {
  items: { label: string; href: string; active: boolean }[];
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-panel-border scrollbar-none">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors duration-150 focus-visible:outline-2",
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
