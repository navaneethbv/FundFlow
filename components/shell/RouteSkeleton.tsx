import type { ReactNode } from "react";
import AppShell from "@/components/shell/AppShell";
import type { AppShellActive } from "@/components/shell/nav-model";

/**
 * Loading state that keeps the app shell mounted: navigation swaps the
 * content area, never the frame. The default skeleton mirrors a register
 * page's structure — page title, four summary tiles, one tall ledger panel —
 * as static `panel-hover` blocks under the global reduced-motion kill-switch.
 * Routes whose loading shape differs pass their own blocks as children
 * (budget's twelve-month grid, for example).
 */
export default function RouteSkeleton({
  active,
  label,
  children,
}: Readonly<{
  active: AppShellActive;
  label: string;
  children?: ReactNode;
}>) {
  return (
    <AppShell active={active} skeleton>
      <div className="space-y-4" aria-busy="true" aria-label={`Loading ${label}`}>
        {children ?? (
          <>
            <div className="h-10 w-48 animate-pulse rounded-field bg-panel-hover" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  className="h-28 animate-pulse rounded-card bg-panel-hover"
                />
              ))}
            </div>
            <div className="h-72 animate-pulse rounded-card bg-panel-hover" />
          </>
        )}
      </div>
    </AppShell>
  );
}
