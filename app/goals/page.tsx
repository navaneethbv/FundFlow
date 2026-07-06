import AppShell from "@/components/shell/AppShell";
import ButtonLink from "@/components/ui/ButtonLink";
import EmptyState from "@/components/ui/EmptyState";
import { Target } from "@/components/ui/icons";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <AppShell active="goals" email={user?.email}>
      <div>
        <p className="eyebrow">Planning</p>
        <h1 className="display mt-2 text-3xl sm:text-4xl">Goals</h1>
      </div>
      <EmptyState
        icon={<Target aria-hidden className="h-5 w-5" />}
        title="Goals are coming soon"
        description="This space will track savings targets and monthly progress once the planning workflow is ready."
        action={
          <ButtonLink href="/dashboard" variant="secondary">
            Back to overview
          </ButtonLink>
        }
      />
    </AppShell>
  );
}
