import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import ButtonLink from "@/components/ui/ButtonLink";
import ImportHistory, { ImportHistoryPagination } from "@/components/settings/ImportHistory";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { requireUser } from "@/lib/http";
import { importHistoryPage, loadImportHistory } from "@/lib/import-history";
import { firstSearchParam } from "@/lib/search-params";

export const metadata = { title: "Import history" };

export const dynamic = "force-dynamic";

export default async function ImportHistoryPage({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  if (!isFeatureEnabled("importHistory")) notFound();
  const auth = await requireUser();
  if (auth instanceof NextResponse) notFound();
  const page = importHistoryPage(firstSearchParam((await searchParams).page));
  const { batches, hasNext } = await loadImportHistory(auth.supabase, auth.user.id, page);
  return <AppShell active="settings" email={auth.user.email}>
    <PageHeader title="Import history" actions={<ButtonLink href="/settings?section=data">Import a file</ButtonLink>} />
    <ImportHistory batches={batches} />
    <ImportHistoryPagination page={page} hasNext={hasNext} />
  </AppShell>;
}
