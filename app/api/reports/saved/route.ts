import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Original GET removed – pagination version retained below
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');

    const limit = limitParam ? Math.min(Number(limitParam), 100) : 20;
    const offset = offsetParam ? Number(offsetParam) : 0;

    if (isNaN(limit) || isNaN(offset) || limit < 1 || offset < 0) {
      return NextResponse.json({ error: "Invalid pagination parameters" }, { status: 400 });
    }

    const { data, error, count } = await supabase
      .from("saved_reports")
      .select("id, name, report_type, filters, created_at, updated_at", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ reports: data || [], total: count ?? 0 });
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
