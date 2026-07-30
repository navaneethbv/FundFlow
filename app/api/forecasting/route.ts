import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/http';
import { runMonteCarloForecast } from '@/lib/forecasting';
import type { ForecastInput } from '@/lib/planning';

/**
 * POST /api/forecasting
 * Body: ForecastInput
 * Returns a CashFlowForecast
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const body: ForecastInput = await request.json();
    const forecast = runMonteCarloForecast(body);
    return NextResponse.json({ forecast });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Forecast failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
