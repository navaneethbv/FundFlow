import Link from "next/link";
import SearchButton from "@/components/shell/SearchButton";
import NotificationsBell from "@/components/shell/NotificationsBell";
import { Settings } from "@/components/ui/icons";

/**
 * The icon row Monarch keeps at the top of its sidebar (search, bell,
 * gear) — absorbed from the old top bar now that the shell has no separate
 * bar spanning the sidebar and content. Deliberately not the *only* way to
 * reach Notifications or Settings: both stay in the nav list below too
 * (unlike Monarch, which only exposes them here), because hiding this row
 * when the sidebar is collapsed must never leave a destination unreachable.
 * A distinct nav landmark ("Shell utilities") disambiguates these links
 * from the nav list's own Notifications/Settings entries for anything
 * (tests, screen readers) that needs to tell them apart.
 */
export default function SidebarUtilityIcons() {
  return (
    <nav
      aria-label="Shell utilities"
      className="hidden items-center gap-1 lg:flex group-data-[collapsed=true]/sidebar:hidden"
    >
      <SearchButton />
      <NotificationsBell />
      <Link
        href="/settings"
        aria-label="Settings"
        title="Settings"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-panel-border bg-panel-2 text-muted shadow-sm transition-colors duration-150 hover:border-accent/50 hover:text-foreground focus-visible:outline-2"
      >
        <Settings aria-hidden className="h-[1.15rem] w-[1.15rem]" />
      </Link>
    </nav>
  );
}
