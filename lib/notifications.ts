import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { buildNotification, shouldSendAlert, type AlertType } from "@/lib/planning";
import { getDashboardData } from "@/lib/dashboard";
import { getGoals } from "@/lib/goals";
import { detectNetWorthMilestones } from "@/lib/insights";
import { sendPushToUser } from "@/lib/push";
import { formatCurrency } from "@/lib/format";
import { logError } from "@/lib/log";

/** A Postgres unique-violation (SQLSTATE 23505) means another run claimed it. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { code?: unknown }).code === "23505" ||
      ((error as { message?: unknown }).message?.toString() ?? "").includes(
        "duplicate key",
      ))
  );
}

/**
 * Creates and inserts a notification into the database if the user has opted in
 * and the event is not a duplicate.
 *
 * Dedupe contract: the default `window` mode preserves the legacy day/month
 * window and optional subject matching. `exact` mode stores `subjectKey` in the
 * `subject_key` column and suppresses an existing `(user_id, type, subject_key)`
 * row, with the partial unique index handling concurrent runs. Use exact mode
 * only for events whose key represents the event identity, such as a goal id,
 * a monthly category key, or a transaction id.
 */
export type NotificationDedupe = "window" | "exact";

type NotificationDetails = { title: string; body: string };
type TryNotify = (
  type: AlertType,
  details: NotificationDetails,
  subjectKey?: string,
) => Promise<unknown>;
type NotificationDashboardData = Awaited<ReturnType<typeof getDashboardData>>;

async function notifyLowCashForecast(
  dashboardData: NotificationDashboardData,
  today: string,
  tryNotify: TryNotify,
): Promise<void> {
  const forecast = dashboardData.cashFlowForecast;
  if (!forecast?.lowBalanceRisk) return;
  await tryNotify(
    "low_cash_forecast",
    {
      title: "Low cash forecast",
      body: `Your projected balance is expected to drop to a low of ${formatCurrency(forecast.lowestBalance)} in the next 30 days.`,
    },
    `low_cash_forecast:${today}`,
  );
}

async function notifyBudgetEnvelopes(
  dashboardData: NotificationDashboardData,
  currentMonth: string,
  tryNotify: TryNotify,
): Promise<void> {
  for (const envelope of dashboardData.budgetEnvelopes ?? []) {
    if (envelope.status !== "over") continue;
    const exceeded = envelope.spent - envelope.monthlyLimit;
    await tryNotify(
      "budget_exceeded",
      {
        title: `Budget exceeded: ${envelope.category}`,
        body: `You have exceeded your monthly budget for ${envelope.category} by ${formatCurrency(exceeded)}.`,
      },
      `budget_exceeded:${envelope.category}:${currentMonth}`,
    );
  }
}

async function notifyReachedGoals(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  tryNotify: TryNotify,
): Promise<void> {
  const goals = await getGoals(supabase, userId);
  for (const goal of goals) {
    if (goal.saved_amount < goal.target_amount) continue;
    await tryNotify(
      "goal_reached",
      {
        title: `Goal reached: ${goal.name}`,
        body: `Congratulations! You have reached your target of ${formatCurrency(goal.target_amount)} for ${goal.name}.`,
      },
      `goal_reached:${goal.id}`,
    );
  }
}

async function notifyNetWorthMilestones(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  dashboardData: NotificationDashboardData,
  tryNotify: TryNotify,
): Promise<void> {
  try {
    const { data: achievedRows } = await supabase
      .from("milestones")
      .select("key")
      .eq("user_id", userId);
    const milestones = detectNetWorthMilestones({
      history: dashboardData.netWorthHistory.map((row) => ({
        month: row.month,
        netWorth: row.netWorth,
      })),
      achieved: (achievedRows ?? []).map((row) => row.key as string),
    });
    for (const milestone of milestones) {
      const { error: claimError } = await supabase.from("milestones").insert({
        user_id: userId,
        key: milestone.key,
        title: milestone.title,
      });
      if (claimError) continue;
      await tryNotify(
        "milestone",
        { title: milestone.title, body: milestone.body },
        milestone.key,
      );
    }
  } catch (milestoneError) {
    logError("notifications.milestones", milestoneError);
  }
}

// A broken connection stays broken until the user re-links it, so the subject
// key carries the day: under `exact` dedupe an id-only key would alert once
// ever, and the daily digest (which force-includes broken_bank) would go
// silent with it. This keeps the legacy once-per-day cadence.
async function notifyBrokenBanks(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  today: string,
  tryNotify: TryNotify,
): Promise<void> {
  const { data: items } = await supabase
    .from("plaid_items")
    .select("id, institution_name, status, error_code")
    .eq("user_id", userId);

  for (const item of items ?? []) {
    if (item.status !== "error") continue;
    await tryNotify(
      "broken_bank",
      {
        title: `Bank connection issue: ${item.institution_name || "Bank"}`,
        body: `The connection to ${item.institution_name || "your bank"} needs to be updated (error: ${item.error_code || "unknown"}).`,
      },
      `broken_bank:${item.id}:${today}`,
    );
  }
}

export async function createNotification(
  userId: string,
  type: AlertType,
  details: { title: string; body: string },
  subjectKey?: string,
  dedupe: NotificationDedupe = "window",
) {
  const supabase = createServiceClient();

  // 1. Fetch user's alert preferences
  const { data: prefs } = await supabase
    .from("alert_preferences")
    .select("*")
    .eq("user_id", userId)
    .single();

  const preferences = prefs || {
    broken_bank: true,
    budget_exceeded: true,
    goal_reached: true,
    large_transaction: false,
    low_cash_forecast: true,
  };

  if (type !== "broken_bank" && !shouldSendAlert(type, preferences)) {
    return null;
  }

  // 2. Deduplicate
  if (subjectKey && dedupe === "exact") {
    const { data: existing, error } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", type)
      .eq("subject_key", subjectKey)
      .maybeSingle();
    if (error) throw error;
    if (existing) return null;
  } else {
    // The legacy window allows distinct subject alerts of the same type in the
    // same window, while suppressing a repeated subject.
    const now = new Date();
    const startRange =
      type === "budget_exceeded"
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const { data: existing, error } = await supabase
      .from("notifications")
      .select("id, title, body")
      .eq("user_id", userId)
      .eq("type", type)
      .gte("created_at", startRange);
    if (error) throw error;
    if (existing && existing.length > 0) {
      if (!subjectKey) return null;
      const lowerSubject = subjectKey.toLowerCase();
      const isDuplicate = existing.some(
        (notification) =>
          notification.title.toLowerCase().includes(lowerSubject) ||
          notification.body.toLowerCase().includes(lowerSubject),
      );
      if (isDuplicate) return null;
    }
  }

  // 3. Create & insert notification
  const shape = buildNotification(type, details);
  const { data: inserted, error: insertError } = await supabase
    .from("notifications")
    .insert({
      user_id: userId,
      ...shape,
      subject_key: dedupe === "exact" ? subjectKey ?? null : null,
    })
    .select()
    .single();

  // A concurrent run inserted the same subject between our check and this
  // insert; that is the same duplicate the unique index exists to stop.
  if (insertError) {
    if (subjectKey && dedupe === "exact" && isUniqueViolation(insertError)) {
      return null;
    }
    throw insertError;
  }

  // Mirror to web push (fire-and-forget; no-op without VAPID keys).
  void sendPushToUser(userId, { title: shape.title, body: shape.body });

  return inserted;
}

/**
 * Runs planning checks for the user and generates notifications for budget exceed,
 * low cash forecast, goal reached, and broken bank connections.
 */
export async function processNotificationsForUser(userId: string) {
  const supabase = createServiceClient();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);

  const tryNotify: TryNotify = (type, details, subjectKey) =>
    createNotification(userId, type, details, subjectKey, "exact").catch((error) =>
      logError(`notifications.${type}`, error),
    );

  const dashboardData = await getDashboardData(
    supabase,
    undefined,
    currentMonth,
    userId,
  );

  await notifyLowCashForecast(dashboardData, today, tryNotify);
  await notifyBudgetEnvelopes(dashboardData, currentMonth, tryNotify);
  await notifyReachedGoals(supabase, userId, tryNotify);
  await notifyNetWorthMilestones(supabase, userId, dashboardData, tryNotify);
  await notifyBrokenBanks(supabase, userId, today, tryNotify);
}

/**
 * Unread count for the top-bar bell (Phase 1). Takes the caller's own
 * RLS-bound client (not the service client) since this always runs for the
 * signed-in user reading their own notifications. Fails open to 0 so a
 * transient query error never breaks the shell chrome.
 */
export async function getUnreadNotificationCount(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) return 0;
  return count ?? 0;
}
