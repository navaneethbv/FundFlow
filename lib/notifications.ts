import { createServiceClient } from "@/lib/supabase/service";
import { buildNotification, shouldSendAlert, type AlertType } from "@/lib/planning";
import { getDashboardData } from "@/lib/dashboard";
import { getGoals } from "@/lib/goals";
import { detectNetWorthMilestones } from "@/lib/insights";
import { sendPushToUser } from "@/lib/push";
import { formatCurrency } from "@/lib/format";
import { logError } from "@/lib/log";

/**
 * Creates and inserts a notification into the database if the user has opted in
 * and the event is not a duplicate.
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
  const now = new Date();
  let startRange: string;
  if (type === "budget_exceeded") {
    // Current month start (UTC)
    startRange = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  } else {
    // Current day start (UTC)
    startRange = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }

  // Query existing notifications in the window
  const { data: existing, error } = await supabase
    .from("notifications")
    .select("id, title, body")
    .eq("user_id", userId)
    .eq("type", type)
    .gte("created_at", startRange);

  if (error) throw error;

  if (existing && existing.length > 0) {
    if (subjectKey) {
      const lowerSubject = subjectKey.toLowerCase();
      const isDupe = existing.some(
        (n) =>
          n.title.toLowerCase().includes(lowerSubject) ||
          n.body.toLowerCase().includes(lowerSubject),
      );
      if (isDupe) return null;
    } else {
      // If no subjectKey, any notification of this type in the window is a duplicate
      return null;
    }
  }

  // 3. Create & insert notification
  const shape = buildNotification(type, details);
  const { data: inserted, error: insertError } = await supabase
    .from("notifications")
    .insert({
      user_id: userId,
      ...shape,
    })
    .select()
    .single();

  if (insertError) throw insertError;

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

  // 1. Run dashboard aggregation & planning forecast. This uses the service
  // client (RLS bypassed), so userId MUST be passed to scope every query to
  // this user — otherwise the aggregation would span all users' data.
  const dashboardData = await getDashboardData(supabase, undefined, currentMonth, userId);

  // 2. Check low cash forecast
  if (dashboardData.cashFlowForecast?.lowBalanceRisk) {
    const lowest = dashboardData.cashFlowForecast.lowestBalance;
    await createNotification(
      userId,
      "low_cash_forecast",
      {
        title: "Low cash forecast",
        body: `Your projected balance is expected to drop to a low of ${formatCurrency(lowest)} in the next 30 days.`,
      },
      "low_cash_forecast",
    );
  }

  // 3. Check budget envelopes
  for (const envelope of dashboardData.budgetEnvelopes || []) {
    if (envelope.status === "over") {
      const exceeded = envelope.spent - envelope.monthlyLimit;
      await createNotification(
        userId,
        "budget_exceeded",
        {
          title: `Budget exceeded: ${envelope.category}`,
          body: `You have exceeded your monthly budget for ${envelope.category} by ${formatCurrency(exceeded)}.`,
        },
        envelope.category,
      );
    }
  }

  // 4. Check goals reached. Service client (RLS bypassed) — pass userId so
  // goals are scoped to this user, otherwise every user's goals leak in.
  const goals = await getGoals(supabase, userId);
  for (const goal of goals) {
    if (goal.saved_amount >= goal.target_amount) {
      await createNotification(
        userId,
        "goal_reached",
        {
          title: `Goal reached: ${goal.name}`,
          body: `Congratulations! You have reached your target of ${formatCurrency(goal.target_amount)} for ${goal.name}.`,
        },
        goal.id,
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
      await createNotification(
        userId,
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
      await createNotification(
        userId,
        "broken_bank",
        {
          title: `Bank connection issue: ${item.institution_name || "Bank"}`,
          body: `The connection to ${item.institution_name || "your bank"} needs to be updated (error: ${item.error_code || "unknown"}).`,
        },
        item.id,
      );
    }
  }
}
