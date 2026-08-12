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
 * Dedupe contract: when `subjectKey` is given, the row stores it in the
 * `subject_key` column and is suppressed if `(user_id, type, subject_key)`
 * already exists. The partial unique index on those three columns is the
 * enforcement (the same pattern the milestones table uses), so concurrent
 * runs cannot double-insert and an inert substring match on rendered text
 * cannot let the event repeat. Callers encode the intended frequency in the
 * key: a goal id for a once-ever "goal reached", a `category:YYYY-MM` for a
 * monthly budget alert, a day-stamped key for daily alerts. Callers without a
 * stable subject keep the legacy window dedupe (no subject_key column set).
 */
export async function createNotification(
  userId: string,
  type: AlertType,
  details: { title: string; body: string },
  subjectKey?: string,
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
  if (subjectKey) {
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
    // No stable subject: fall back to the legacy window — any notification of
    // this type since the window start counts as a duplicate.
    const now = new Date();
    const startRange =
      type === "budget_exceeded"
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const { data: existing, error } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", type)
      .gte("created_at", startRange);
    if (error) throw error;
    if (existing && existing.length > 0) return null;
  }

  // 3. Create & insert notification
  const shape = buildNotification(type, details);
  const { data: inserted, error: insertError } = await supabase
    .from("notifications")
    .insert({
      user_id: userId,
      ...shape,
      subject_key: subjectKey ?? null,
    })
    .select()
    .single();

  // A concurrent run inserted the same subject between our check and this
  // insert; that is the same duplicate the unique index exists to stop.
  if (insertError) {
    if (subjectKey && isUniqueViolation(insertError)) return null;
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
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // A failure in one alert (a preferences read, a dedupe check, or an insert)
  // must not abort the other alerts this run would emit. Each check is
  // isolated so a database hiccup on one channel leaves the rest intact.
  const tryNotify = (
    type: AlertType,
    details: { title: string; body: string },
    subjectKey?: string,
  ) =>
    createNotification(userId, type, details, subjectKey).catch((error) =>
      logError(`notifications.${type}`, error),
    );

  // 1. Run dashboard aggregation & planning forecast. This uses the service
  // client (RLS bypassed), so userId MUST be passed to scope every query to
  // this user — otherwise the aggregation would span all users' data.
  const dashboardData = await getDashboardData(supabase, undefined, currentMonth, userId);

  // 2. Check low cash forecast
  if (dashboardData.cashFlowForecast?.lowBalanceRisk) {
    const lowest = dashboardData.cashFlowForecast.lowestBalance;
    await tryNotify(
      "low_cash_forecast",
      {
        title: "Low cash forecast",
        body: `Your projected balance is expected to drop to a low of ${formatCurrency(lowest)} in the next 30 days.`,
      },
      `low_cash_forecast:${today}`,
    );
  }

  // 3. Check budget envelopes
  for (const envelope of dashboardData.budgetEnvelopes || []) {
    if (envelope.status === "over") {
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

  // 4. Check goals reached. Service client (RLS bypassed) — pass userId so
  // goals are scoped to this user, otherwise every user's goals leak in.
  const goals = await getGoals(supabase, userId);
  for (const goal of goals) {
    if (goal.saved_amount >= goal.target_amount) {
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

  // 4b. Net-worth milestones (8.2). The unique (user_id, key) constraint is
  // the dedupe: the insert claims the milestone, and only a successful
  // claim notifies — so each key fires exactly once, ever. Best-effort.
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
      if (claimError) continue; // already claimed (or table missing) — stay silent
      await tryNotify(
        "milestone",
        { title: milestone.title, body: milestone.body },
        milestone.key,
      );
    }
  } catch (milestoneError) {
    logError("notifications.milestones", milestoneError);
  }

  // 5. Check broken bank connections
  const { data: items } = await supabase
    .from("plaid_items")
    .select("id, institution_name, status, error_code")
    .eq("user_id", userId);

  for (const item of items || []) {
    if (item.status === "error") {
      await tryNotify(
        "broken_bank",
        {
          title: `Bank connection issue: ${item.institution_name || "Bank"}`,
          body: `The connection to ${item.institution_name || "your bank"} needs to be updated (error: ${item.error_code || "unknown"}).`,
        },
        `broken_bank:${item.id}`,
      );
    }
  }
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
