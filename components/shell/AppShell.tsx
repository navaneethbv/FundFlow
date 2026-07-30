import type { ReactNode } from "react";
import AppSidebar, { type AppShellActive } from "@/components/shell/AppSidebar";
import CommandPalette from "@/components/CommandPalette";
import TopBar from "@/components/shell/TopBar";
import { getEnabledNavItems } from "@/components/shell/nav-model";
import { dashboardUrl } from "@/lib/drilldown";

const EXTRA_COMMANDS = [
  { label: "Plan view", href: dashboardUrl({ view: "plan" }), hint: "Budgets, bills, debt" },
  { label: "Wealth view", href: dashboardUrl({ view: "wealth" }), hint: "Net worth and breakdowns" },
  { label: "Review", href: "/review", hint: "Monthly review" },
  { label: "Export CSV", href: "/api/export/csv", hint: "Privacy-safe download" },
  { label: "Tax CSV", href: "/api/export/csv?scope=tax", hint: "Tax-tagged download" },
];

export default function AppShell({
  active,
  email,
  children,
}: Readonly<{
  active: AppShellActive;
  email?: string | null;
  children: ReactNode;
}>) {
  const commands = [
    ...getEnabledNavItems().map((item) => ({ label: item.label, href: item.href, hint: item.hint })),
    ...EXTRA_COMMANDS,
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <CommandPalette items={commands} />
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
