import type { ReactNode } from "react";
import AppSidebar, { type AppShellActive } from "@/components/shell/AppSidebar";
import TopBar from "@/components/shell/TopBar";

export default function AppShell({
  active,
  email,
  children,
}: {
  active: AppShellActive;
  email?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar email={email} />
      <div className="lg:flex">
        <AppSidebar active={active} />
        <main className="w-full min-w-0 px-4 py-5 sm:px-6 lg:px-7 lg:py-7">
          <div className="mx-auto max-w-[1320px] space-y-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
