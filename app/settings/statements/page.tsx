import { NextResponse } from "next/server";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import ButtonLink from "@/components/ui/ButtonLink";
import StatementVault from "@/components/settings/StatementVault";
import { accountDisplayLabel } from "@/lib/account-label";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { requireUser } from "@/lib/http";
import { recentStatementMonths, type StatementCoverageAccount, type StatementMetadata } from "@/lib/statement-vault";

export const metadata = { title: "Statement vault" };
export const dynamic = "force-dynamic";

export default async function StatementVaultPage() {
  if (!isFeatureEnabled("statementVault")) notFound();
  const auth = await requireUser();
  if (auth instanceof NextResponse) redirect("/login");

  const [{ data: accounts }, { data: manualAccounts }, { data: statements }] = await Promise.all([
    auth.supabase.from("accounts").select("id, name, mask").eq("user_id", auth.user.id).order("name"),
    auth.supabase.from("manual_accounts").select("id, name, account_type").eq("user_id", auth.user.id).order("name"),
    auth.supabase.from("account_statements").select("id, account_id, manual_account_id, statement_month, original_filename, content_type, size_bytes, created_at").order("statement_month", { ascending: false }).order("created_at", { ascending: false }),
  ]);

  const coverageAccounts: StatementCoverageAccount[] = [
    ...((accounts ?? []) as Array<{ id: string; name: string | null; mask: string | null }>).map((account) => ({
      ref: { source: "account" as const, id: account.id },
      label: accountDisplayLabel(account.name, account.mask),
    })),
    ...((manualAccounts ?? []) as Array<{ id: string; name: string | null; account_type: string | null }>).map((account) => ({
      ref: { source: "manual" as const, id: account.id },
      label: `${account.name || account.account_type || "Manual account"} (manual)`,
    })),
  ];
  const initialStatements: StatementMetadata[] = ((statements ?? []) as Array<{
    id: string;
    account_id: string | null;
    manual_account_id: string | null;
    statement_month: string;
    original_filename: string;
    content_type: string;
    size_bytes: number;
    created_at: string;
  }>).map((statement) => ({
    id: statement.id,
    accountId: statement.account_id,
    manualAccountId: statement.manual_account_id,
    statementMonth: statement.statement_month,
    originalFilename: statement.original_filename,
    contentType: statement.content_type,
    sizeBytes: statement.size_bytes,
    createdAt: statement.created_at,
  }));

  return (
    <AppShell active="settings" email={auth.user.email}>
      <PageHeader title="Statement vault" actions={<ButtonLink href="/settings?section=institutions">Institution settings</ButtonLink>} />
      <StatementVault accounts={coverageAccounts} months={recentStatementMonths()} initialStatements={initialStatements} />
    </AppShell>
  );
}
