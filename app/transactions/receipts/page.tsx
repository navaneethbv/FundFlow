import { notFound } from "next/navigation";
import ReceiptInbox from "@/components/transactions/ReceiptInbox";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import ButtonLink from "@/components/ui/ButtonLink";
import { loadReceiptInbox } from "@/lib/receipt-data";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Receipt inbox",
};

export default async function ReceiptsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const receipts = await loadReceiptInbox(
    supabase,
    createServiceClient(),
    user.id,
  );

  return (
    <AppShell active="transactions" email={user.email}>
      <div className="space-y-6">
        <PageHeader
          title="Receipt inbox"
          actions={<ButtonLink href="/transactions">Back to transactions</ButtonLink>}
        />
        <ReceiptInbox initialReceipts={receipts} />
      </div>
    </AppShell>
  );
}
