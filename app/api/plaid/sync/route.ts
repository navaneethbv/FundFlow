import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/http";
import { syncAllForUser } from "@/lib/sync";
import { refreshRecurringForUser, type RecurringRefreshResult } from "@/lib/recurring";
import { refreshInferredRecurringForUser } from "@/lib/recurring-inference";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";
import { tryWriteDailyAccountSnapshots } from "@/lib/account-history";
import { logError } from "@/lib/log";

const ZERO_INFERRED = { active: 0, added: 0, deactivated: 0, deduplicated: 0 };

/** Auto-pulls (AutoRefresh component) may hit Plaid at most once per window. */
const AUTO_SYNC_WINDOW_SECONDS = 30 * 60;

/**
 * On-demand "Refresh": sync transactions + recurring streams for the user.
 *
 * Two callers share this route:
 * - Manual refresh (no body / source omitted): 6/min limiter, audited.
 * - Background auto-refresh ({ source: "auto" }): additionally gated by a
 *   30-minute per-user window enforced HERE (the client's timer is only a
 *   courtesy — multiple tabs/devices can't multiply Plaid calls). A consumed
 *   window returns 200 { skipped: true } rather than an error, and auto runs
 *   are not audited (sync_jobs already records every run); the UI still
 *   re-renders to pick up anything the webhook delivered meanwhile.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  let isAuto = false;
  try {
    const body = await request.json();
    isAuto = body?.source === "auto";
  } catch {
    // No body → manual refresh.
  }

  if (isAuto) {
    const windowOpen = await checkRateLimit(
      `autosync:${user.id}`,
      1,
      AUTO_SYNC_WINDOW_SECONDS,
    );
    if (!windowOpen) {
      return NextResponse.json({ ok: true, skipped: true });
    }
  }

  const allowed = await checkRateLimit(`sync:${user.id}`, 6, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many refreshes. Please wait a moment." },
      { status: 429 },
    );
  }

  try {
    const result = await syncAllForUser(user.id);
    await tryWriteDailyAccountSnapshots(user.id, "plaid.sync.snapshot");

    // Recurring streams change slowly (weekly at best) but the Plaid
    // recurring endpoint costs one call per item. Manual refresh and the
    // daily cron run the full hybrid path (Plaid refresh + local
    // inference); auto-pulls run local inference only, so steady-state
    // Plaid request volume stays unchanged.
    let recurring: RecurringRefreshResult;
    if (isAuto) {
      try {
        recurring = {
          plaid: 0,
          inferred: await refreshInferredRecurringForUser(user.id),
        };
      } catch (error) {
        logError("plaid.sync.recurring-inference", error);
        recurring = { plaid: 0, inferred: ZERO_INFERRED };
      }
    } else {
      recurring = await refreshRecurringForUser(user.id);
    }

    if (!isAuto) {
      await writeAudit({
        userId: user.id,
        action: "data_refresh",
        metadata: { ...result, recurring_streams: recurring },
        ip: getClientIp(request),
      });
    }

    return NextResponse.json({ ok: true, ...result, recurring_streams: recurring });
  } catch (error) {
    return errorResponse("plaid.sync", error);
  }
}
