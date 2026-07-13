import Link from "next/link";
import Logo from "@/components/ui/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";

export default function TopBar({ email }: { email?: string | null }) {
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
          <ThemeToggle variant="switch" />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
