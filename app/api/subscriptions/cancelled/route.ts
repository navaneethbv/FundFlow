import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";

/**
 * Subscription cancellation watch (Bucket 2): mark/unmark a merchant as
 * cancelled. The sync alerts if a marked merchant charges again. Rows are
 * written with the user-scoped client under owner RLS.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as { merchant?: string } | null;
    const merchant = body?.merchant?.trim();
    if (!merchant || merchant.length > 160) return badRequest("merchant is required");

    const { error } = await supabase
      .from("cancelled_subscriptions")
      .insert({ user_id: user.id, merchant });
    if (error && !error.message.includes("duplicate")) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("subscriptions.cancelled.add", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as { merchant?: string } | null;
    const merchant = body?.merchant?.trim();
    if (!merchant) return badRequest("merchant is required");

    const { error } = await supabase
      .from("cancelled_subscriptions")
      .delete()
      .eq("merchant", merchant);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("subscriptions.cancelled.remove", error);
  }
}
