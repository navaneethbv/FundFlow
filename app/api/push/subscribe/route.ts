import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { isAllowedPushEndpoint } from "@/lib/push";

/** Register/unregister a browser push subscription (owner RLS writes). */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    } | null;
    if (!body?.endpoint || !body.keys?.p256dh || !body.keys.auth) {
      return badRequest("A push subscription (endpoint + keys) is required");
    }
    if (!isAllowedPushEndpoint(body.endpoint)) {
      return badRequest("Unsupported push endpoint");
    }

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      { onConflict: "endpoint" },
    );
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("push.subscribe", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as { endpoint?: string } | null;
    if (!body?.endpoint) return badRequest("endpoint is required");

    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", body.endpoint);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("push.unsubscribe", error);
  }
}
