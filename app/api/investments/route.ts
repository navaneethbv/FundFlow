import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/http';
import { getMockHoldings } from '@/lib/investments';

/** GET /api/investments – return mock holdings (replace with real DB later) */
export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const holdings = getMockHoldings();
  return NextResponse.json({ holdings });
}
