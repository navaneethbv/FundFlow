import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import AdviceCard from "@/components/advice/AdviceCard";
import Panel from "@/components/ui/Panel";
import { buildAdviceView } from "@/lib/advice";
import { ADVICE_LIBRARY } from "@/lib/advice-content";
import { loadAdvicePageData } from "@/lib/advice-data";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdvicePage() {
  if (!isFeatureEnabled("advicePage")) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const { ctx, progress, priorities } = await loadAdvicePageData(supabase, user.id, today);
  const view = buildAdviceView(ADVICE_LIBRARY, progress, priorities, ctx);

  const completedTaskIdsFor = (adviceId: string) =>
    new Set(progress.filter((p) => p.advice_id === adviceId).map((p) => p.task_id));

  return (
    <AppShell active="advice" email={user.email}>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Advice</h1>
          <p className="text-sm text-muted">
            {view.completedCount} of {ADVICE_LIBRARY.length} topics completed.
          </p>
          <p className="mt-2 max-w-2xl text-xs text-muted">
            This is general financial education, not personalized financial, legal, tax, or investment
            advice, and it does not diagnose your situation or recommend a specific security, policy, or
            provider. Consider talking with a qualified professional for advice specific to you.
          </p>
        </header>

        {view.prioritized.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Prioritized by you</h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {view.prioritized.map((item) => (
                <AdviceCard
                  key={item.id}
                  item={item}
                  done={item.done}
                  total={item.total}
                  completedTaskIds={completedTaskIdsFor(item.id)}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Essential advice</h2>
          {view.essential.length === 0 ? (
            <Panel padding="lg">
              <p className="text-sm text-muted">Nothing left here — check Prioritized above.</p>
            </Panel>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {view.essential.map((item) => (
                <AdviceCard
                  key={item.id}
                  item={item}
                  done={item.done}
                  total={item.total}
                  completedTaskIds={completedTaskIdsFor(item.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
