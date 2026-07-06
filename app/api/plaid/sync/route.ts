import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/http";
import { syncAllForUser } from "@/lib/sync";
import { refreshRecurringForUser } from "@/lib/recurring";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";

/** On-demand "Refresh": sync transactions + recurring streams for the user. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const allowed = await checkRateLimit(`sync:${user.id}`, 6, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many refreshes. Please wait a moment." },
      { status: 429 },
    );
  }

  try {
    const result = await syncAllForUser(user.id);
    const recurring = await refreshRecurringForUser(user.id);

    await writeAudit({
      userId: user.id,
      action: "data_refresh",
      metadata: { ...result, recurring_streams: recurring },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true, ...result, recurring_streams: recurring });
  } catch (error) {
    return errorResponse("plaid.sync", error);
  }
}
