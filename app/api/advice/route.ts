import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { advice_id, task_id, completed } = body;

    if (!advice_id || !task_id) {
      return NextResponse.json({ error: "Missing advice_id or task_id" }, { status: 400 });
    }

    if (completed) {
      const { error } = await supabase
        .from("advice_progress")
        .upsert(
          {
            user_id: user.id,
            advice_id,
            task_id,
            content_version: 1,
          },
          { onConflict: "user_id,advice_id,task_id" },
        );

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      await supabase
        .from("advice_progress")
        .delete()
        .eq("user_id", user.id)
        .eq("advice_id", advice_id)
        .eq("task_id", task_id);
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update advice task";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
