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
    const { goal_id, account_id, allocated_amount, use_entire_balance } = body;

    if (!goal_id || !account_id) {
      return NextResponse.json({ error: "Missing goal_id or account_id" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("goal_accounts")
      .upsert(
        {
          user_id: user.id,
          goal_id,
          account_id,
          allocated_amount: allocated_amount ? Number(allocated_amount) : null,
          use_entire_balance: Boolean(use_entire_balance),
        },
        { onConflict: "goal_id,account_id" },
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ link: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to link goal account";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
