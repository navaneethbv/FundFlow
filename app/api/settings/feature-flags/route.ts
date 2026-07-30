import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/http';

/**
 * GET /api/settings/feature-flags – return user's feature-flag overrides
 * POST /api/settings/feature-flags – save overrides
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, userId } = auth;

  const { data } = await supabase
    .from('user_settings')
    .select('feature_flags')
    .eq('user_id', userId)
    .maybeSingle();

  return NextResponse.json({ flags: data?.feature_flags ?? {} });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, userId } = auth;

  const body = await request.json();
  const flags = body.flags ?? {};

  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, feature_flags: flags }, { onConflict: 'user_id' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
