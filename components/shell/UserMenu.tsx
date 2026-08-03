"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PrivacyToggle from "@/components/PrivacyToggle";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";
import { ChevronDown, Settings } from "@/components/ui/icons";

/**
 * The sidebar's bottom-pinned identity block: avatar + name + chevron,
 * opening a menu that holds everything the old top bar carried besides the
 * utility icons (Settings, privacy blur, theme, sign out) — Monarch's own
 * account menu is the reference for *where* this lives, not for what's
 * inside it, since FundFlow has no equivalent surface elsewhere to move
 * these three controls to.
 */
export default function UserMenu({
  displayName,
  email,
  avatarUrl,
}: Readonly<{
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
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

  const initial = displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="relative">
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
        aria-label={`Account menu for ${displayName}`}
        className="flex w-full items-center gap-2 rounded-field p-2 text-left transition-colors duration-150 hover:bg-panel-hover focus-visible:outline-2 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:p-0"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-sm font-bold text-accent">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed Supabase Storage URL, same pattern as ProfileSection.
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold md:sr-only lg:not-sr-only group-data-[collapsed=true]/sidebar:sr-only">
          {displayName}
        </span>
        <ChevronDown
          aria-hidden
          className="h-4 w-4 shrink-0 text-muted md:sr-only lg:not-sr-only group-data-[collapsed=true]/sidebar:sr-only"
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute bottom-full left-0 z-40 mb-2 w-64 rounded-card border border-panel-border bg-panel p-2 shadow-float"
        >
          {email && (
            <p className="truncate px-2 pb-2 pt-1 text-xs text-muted">{email}</p>
          )}
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-field px-2 py-2 text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-panel-hover"
          >
            <Settings aria-hidden className="h-4 w-4 text-muted" />
            Settings
          </Link>
          <div className="flex items-center justify-between gap-2 rounded-field px-2 py-2">
            <span className="text-sm font-medium text-foreground">
              Hide amounts
            </span>
            <PrivacyToggle />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-field px-2 py-2">
            <span className="text-sm font-medium text-foreground">Theme</span>
            <ThemeToggle variant="switch" />
          </div>
          <div className="my-1 border-t border-panel-border" />
          <div className="px-1 py-1">
            <LogoutButton />
          </div>
        </div>
      )}
    </div>
  );
}
