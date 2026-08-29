import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import AdviceCard from "@/components/advice/AdviceCard";
import AdvicePriorities from "@/components/advice/AdvicePriorities";
import Panel from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import { buildAdviceView, type AdviceCategory, type AdviceItemProgress } from "@/lib/advice";
import { ADVICE_LIBRARY } from "@/lib/advice-content";
import { loadAdvicePageData } from "@/lib/advice-data";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { firstSearchParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ category?: string | string[] }>;
}

const CATEGORY_LABELS: Record<AdviceCategory, string> = {
  save_up: "Save up",
  spend: "Spend",
  pay_down: "Pay down",
  protect: "Protect",
  invest: "Invest",
  wellness: "Wellness",
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as AdviceCategory[];

function isCategory(value: string | undefined): value is AdviceCategory {
  return CATEGORIES.includes(value as AdviceCategory);
}

function adviceHref(category?: AdviceCategory): string {
  return category ? `/advice?category=${category}` : "/advice";
}

/** Items with at least one task that are all checked off. A task-less item is never "completed" — there is nothing to have finished. */
function splitCompleted<T extends AdviceItemProgress>(items: T[]): { active: T[]; completed: T[] } {
  const active: T[] = [];
  const completed: T[] = [];
  for (const item of items) {
    if (item.total > 0 && item.done === item.total) completed.push(item);
    else active.push(item);
  }
  return { active, completed };
}

export default async function AdvicePage({ searchParams }: Readonly<PageProps>) {
  if (!isFeatureEnabled("advicePage")) notFound();

  const params = await searchParams;
  const selectedCategory = isCategory(firstSearchParam(params.category))
    ? (firstSearchParam(params.category) as AdviceCategory)
    : undefined;

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

  const filterByCategory = <T extends { category: AdviceCategory }>(items: T[]) =>
    selectedCategory ? items.filter((item) => item.category === selectedCategory) : items;

  const prioritized = splitCompleted(filterByCategory(view.prioritized));
  const essential = splitCompleted(filterByCategory(view.essential));

  return (
    <AppShell active="advice" email={user.email}>
      <div className="space-y-6">
        <PageHeader title="Advice" />
        <div>
          <p className="text-sm text-muted">
            {view.completedCount} of {ADVICE_LIBRARY.length} topics completed.
          </p>
          <p className="mt-2 max-w-2xl text-xs text-muted">
            This is general financial education, not personalized financial, legal, tax, or investment
            advice, and it does not diagnose your situation or recommend a specific security, policy, or
            provider. Consider talking with a qualified professional for advice specific to you.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
          <div className="min-w-0 space-y-6">
            {prioritized.active.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Prioritized by you</h2>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {prioritized.active.map((item) => (
                    <AdviceCard
                      key={item.id}
                      item={item}
                      done={item.done}
                      total={item.total}
                      completedTaskIds={completedTaskIdsFor(item.id)}
                    />
                  ))}
                </div>
                {prioritized.completed.length > 0 && (
                  <details className="mt-3">
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-accent focus-visible:outline-2">
                      Show {prioritized.completed.length} completed
                    </summary>
                    <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {prioritized.completed.map((item) => (
                        <AdviceCard
                          key={item.id}
                          item={item}
                          done={item.done}
                          total={item.total}
                          completedTaskIds={completedTaskIdsFor(item.id)}
                        />
                      ))}
                    </div>
                  </details>
                )}
              </section>
            )}

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Essential advice</h2>
              {essential.active.length === 0 && essential.completed.length === 0 ? (
                <Panel padding="lg">
                  <p className="text-sm text-muted">Nothing left here — check Prioritized above.</p>
                </Panel>
              ) : (
                <>
                  {essential.active.length === 0 ? (
                    <Panel padding="lg">
                      <p className="text-sm text-muted">Everything essential here is complete.</p>
                    </Panel>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {essential.active.map((item) => (
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
                  {essential.completed.length > 0 && (
                    <details className="mt-3">
                      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-accent focus-visible:outline-2">
                        Show {essential.completed.length} completed
                      </summary>
                      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                        {essential.completed.map((item) => (
                          <AdviceCard
                            key={item.id}
                            item={item}
                            done={item.done}
                            total={item.total}
                            completedTaskIds={completedTaskIdsFor(item.id)}
                          />
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}
            </section>
          </div>

          <nav aria-label="Advice categories" className="space-y-1 lg:sticky lg:top-5">
            <Link
              href={adviceHref()}
              aria-current={!selectedCategory ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-field px-3 text-sm font-semibold transition-colors focus-visible:outline-2",
                !selectedCategory
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-panel-hover hover:text-foreground",
              )}
            >
              Recommendations
            </Link>
            {CATEGORIES.map((category) => (
              <Link
                key={category}
                href={adviceHref(category)}
                aria-current={selectedCategory === category ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center rounded-field px-3 text-sm font-semibold transition-colors focus-visible:outline-2",
                  selectedCategory === category
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-panel-hover hover:text-foreground",
                )}
              >
                {CATEGORY_LABELS[category]}
              </Link>
            ))}
          </nav>
          <AdvicePriorities
            topics={ADVICE_LIBRARY.map((item) => ({ id: item.id, title: item.title }))}
            initialPriorities={priorities ?? []}
          />
        </div>
      </div>
    </AppShell>
  );
}
