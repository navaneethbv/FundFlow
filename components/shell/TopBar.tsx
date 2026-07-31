import Link from "next/link";
import Logo from "@/components/ui/Logo";
import PrivacyToggle from "@/components/PrivacyToggle";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";
import SearchButton from "@/components/shell/SearchButton";
import NotificationsBell from "@/components/shell/NotificationsBell";
import { Settings } from "@/components/ui/icons";

export default function TopBar({ email }: Readonly<{ email?: string | null }>) {
  return (
    <header className="sticky top-0 z-30 border-b border-panel-border bg-background/88 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-7">
        <Link href="/dashboard" className="rounded-field focus-visible:outline-2">
          <Logo />
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          {email && (
            <span className="hidden max-w-[15rem] truncate text-xs font-medium text-muted md:inline">
              {email}
            </span>
          )}
          <div className="hidden items-center gap-2 sm:flex">
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
          </div>
          <PrivacyToggle />
          <ThemeToggle variant="switch" />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
