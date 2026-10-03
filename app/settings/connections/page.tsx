import { NextResponse } from "next/server";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import ButtonLink from "@/components/ui/ButtonLink";
import ConnectionHealth from "@/components/settings/ConnectionHealth";
import { requireUser } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { loadConnectionHealth } from "@/lib/connection-health-data";
export const metadata = { title: "Connection health" };
export const dynamic = "force-dynamic";
export default async function ConnectionsPage() {
  if (!isFeatureEnabled("connectionHealth")) notFound();
  const auth = await requireUser();
  if (auth instanceof NextResponse) redirect("/login");
  const data = await loadConnectionHealth(auth.supabase, auth.user.id);
  if (!data) notFound();
  return (
    <AppShell active="settings" email={auth.user.email}>
      <PageHeader
        title="Connection health"
        actions={
          <ButtonLink href="/settings?section=institutions">
            Institution settings
          </ButtonLink>
        }
      />
      <ConnectionHealth {...data} />
    </AppShell>
  );
}
