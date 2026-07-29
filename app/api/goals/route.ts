import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, target_amount, target_date, goal_type, monthly_contribution, image_slug } = body;

    if (!name || target_amount === undefined || target_amount <= 0) {
      return NextResponse.json({ error: "Invalid goal parameters" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("goals")
      .insert({
        user_id: user.id,
        name,
        target_amount: Number(target_amount),
        saved_amount: 0,
        target_date: target_date || null,
        goal_type: goal_type || "save_up",
        monthly_contribution: monthly_contribution ? Number(monthly_contribution) : null,
        image_slug: image_slug || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await writeAudit({
      userId: user.id,
      action: "data_refresh",
      metadata: { goal_id: data.id },
    });

    return NextResponse.json({ goal: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create goal";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
