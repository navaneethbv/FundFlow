import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/http';
import { generateAdvice, type AdviceInput } from '@/lib/advice';

/**
 * POST /api/advice
 * Body: AdviceInput
 * Returns personalised AdviceItem[]
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const body: AdviceInput = await request.json();
    const advice = generateAdvice(body);
    return NextResponse.json({ advice });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Advice generation failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
