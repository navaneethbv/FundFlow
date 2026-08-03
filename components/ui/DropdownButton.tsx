"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ChevronDown } from "@/components/ui/icons";

export interface DropdownItem {
  label: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
}

/**
 * White pill trigger + chevron opening a floating menu — Monarch's
 * "Expenses ▾", "This month vs. last month ▾", "1 month ▾", "By category &
 * group ▾". An item is a real `<Link>` when it has an `href` (so it's a
 * normal navigable URL, no different from any other control on these
 * server-rendered pages) or a plain action button otherwise. Same
 * backdrop-button + Escape pattern as `UserMenu` and `CommandPalette`,
 * rather than a new outside-click-detection approach.
 */
export default function DropdownButton({
  label,
  items,
  align = "right",
}: Readonly<{
  label: string;
  items: DropdownItem[];
  align?: "left" | "right";
}>) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative inline-block">
      {open && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 cursor-default"
        />
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border border-panel-border bg-panel px-3.5 text-sm font-semibold text-foreground shadow-sm transition-colors duration-150 hover:border-accent/40 focus-visible:outline-2"
      >
        {label}
        <ChevronDown
          aria-hidden
          className={cn("h-3.5 w-3.5 text-muted transition-transform duration-150", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            "absolute z-40 mt-2 w-48 rounded-card border border-panel-border bg-panel p-1.5 shadow-float",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn(
                  "flex min-h-11 items-center rounded-field px-2.5 text-sm font-medium transition-colors duration-150",
                  item.active
                    ? "bg-accent-soft text-accent"
                    : "text-foreground hover:bg-panel-hover",
                )}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  item.onClick?.();
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-11 w-full items-center rounded-field px-2.5 text-left text-sm font-medium transition-colors duration-150",
                  item.active
                    ? "bg-accent-soft text-accent"
                    : "text-foreground hover:bg-panel-hover",
                )}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
