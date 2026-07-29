import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";

export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { budget_id, month, planned, group_name, rollover_enabled } = body;

    if (!budget_id || !month || planned === undefined || planned < 0) {
      return NextResponse.json({ error: "Invalid budget payload" }, { status: 400 });
    }

    const firstOfMonth = `${month.slice(0, 7)}-01`;

    await supabase
      .from("budget_periods")
      .upsert(
        {
          user_id: user.id,
          budget_id,
          month: firstOfMonth,
          planned: Number(planned),
        },
        { onConflict: "budget_id,month" },
      );

    if (group_name || rollover_enabled !== undefined) {
      const updateData: Record<string, unknown> = {};
      if (group_name) updateData.group_name = group_name;
      if (rollover_enabled !== undefined) updateData.rollover_enabled = Boolean(rollover_enabled);

      await supabase
        .from("budgets")
        .update(updateData)
        .eq("id", budget_id)
        .eq("user_id", user.id);
    }

    await writeAudit({
      userId: user.id,
      action: "apr_updated",
      metadata: { budget_id, month: firstOfMonth },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update budget";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
