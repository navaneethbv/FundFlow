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
      .from("user_tags")
      .select("id, name, color_slot")
      .order("name");

    return NextResponse.json({ tags: data || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch tags";
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
    const { name, color_slot } = body;

    if (!name) {
      return NextResponse.json({ error: "Tag name is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("user_tags")
      .insert({
        user_id: user.id,
        name: name.trim(),
        color_slot: color_slot ?? 0,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ tag: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create tag";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
