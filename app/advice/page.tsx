import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import { ADVICE_LIBRARY } from "@/lib/advice-content";
import { buildAdviceView } from "@/lib/advice";
import AdviceCard from "@/components/advice/AdviceCard";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

export default async function AdvicePage() {
  if (!isFeatureEnabled("advicePage")) {
    notFound();
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  // Fetch advice progress
  const { data: progressRows } = await supabase
    .from("advice_progress")
    .select("advice_id, task_id");

  const progress = (progressRows || []).map((p) => ({
    advice_id: p.advice_id as string,
    task_id: p.task_id as string,
  }));

  const adviceView = buildAdviceView(ADVICE_LIBRARY, progress);

  return (
    <AppShell active="advice" email={user.email}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Advice & Guidance</h1>
          <p className="text-sm text-muted">
            Evidence-based financial health checklist and personalized task recommendations
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {adviceView.prioritized.map((item) => (
            <AdviceCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
