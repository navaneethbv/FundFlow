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
    const { merchant_name, amount, frequency, next_date, category } = body;

    if (!merchant_name || amount === undefined || !frequency || !next_date) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("manual_recurring_items")
      .insert({
        user_id: user.id,
        merchant_name,
        amount: Number(amount),
        frequency,
        next_date,
        category: category || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await writeAudit({
      userId: user.id,
      action: "data_refresh",
      metadata: { item_id: data.id },
    });

    return NextResponse.json({ item: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create manual recurring item";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
