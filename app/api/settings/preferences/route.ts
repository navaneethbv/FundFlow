import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/http';

/**
 * GET /api/settings/preferences – return user preferences
 * POST /api/settings/preferences – save user preferences
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, userId } = auth;

  const { data } = await supabase
    .from('user_settings')
    .select('preferences')
    .eq('user_id', userId)
    .maybeSingle();

  return NextResponse.json({ preferences: data?.preferences ?? {} });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, userId } = auth;

  const body = await request.json();
  const preferences = body.preferences ?? {};

  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, preferences }, { onConflict: 'user_id' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
