import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data } = await supabase
      .from("saved_reports")
      .select("id, name, report_type, filters, created_at, updated_at")
      .order("updated_at", { ascending: false });

    return NextResponse.json({ reports: data || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch reports";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, report_type, filters } = body;

    if (!name || !report_type) {
      return NextResponse.json({ error: "Missing name or report_type" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("saved_reports")
      .upsert(
        {
          user_id: user.id,
          name,
          report_type,
          filters: filters || {},
        },
        { onConflict: "user_id,name" },
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ report: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to save report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
