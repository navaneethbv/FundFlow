/**
 * Provider-neutral adapter for market benchmark series (S&P 500, a US stocks
 * index, a US bonds index). Deliberately not wired into any page yet: the
 * plan is explicit that benchmark comparison must not appear in the product
 * until a licensed real market-data source is provisioned and its terms are
 * documented — an unlicensed or scraped feed is a real legal exposure, not a
 * missing feature. This module exists so that day is a config change, not a
 * rewrite: implement `BenchmarkProvider` against the licensed source, wire it
 * into `getBenchmarkProvider`, and only then add UI that calls it.
 */

export type BenchmarkKey = "sp500" | "us_stocks" | "us_bonds";

export interface BenchmarkClose {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface BenchmarkSeriesResult {
  benchmark: BenchmarkKey;
  source: string;
  asOf: string; // when this series was fetched/cached, YYYY-MM-DD
  series: BenchmarkClose[];
}

export interface BenchmarkProvider {
  series(input: { benchmark: BenchmarkKey; start: string; end: string }): Promise<BenchmarkClose[]>;
}

/**
 * No licensed source is configured. Returns an empty series rather than
 * throwing — a caller that forgets to check availability degrades to "no
 * data" instead of a hard failure, matching how the rest of the app treats
 * an absent optional feature.
 */
export const UNAVAILABLE_BENCHMARK_PROVIDER: BenchmarkProvider = {
  async series() {
    return [];
  },
};

/**
 * Daily-close cache keyed by benchmark + date range, so a page rendered
 * repeatedly in one day does not refetch. Module-level → per warm serverless
 * instance, the same lifetime lib/plaid.ts's webhook key cache uses.
 */
const cache = new Map<string, BenchmarkSeriesResult>();

function cacheKey(benchmark: BenchmarkKey, start: string, end: string): string {
  return `${benchmark}:${start}:${end}`;
}

export async function getCachedBenchmarkSeries(
  provider: BenchmarkProvider,
  input: { benchmark: BenchmarkKey; start: string; end: string; source: string; today: string },
): Promise<BenchmarkSeriesResult> {
  const key = cacheKey(input.benchmark, input.start, input.end);
  const cached = cache.get(key);
  if (cached?.asOf === input.today) return cached;

  const series = await provider.series(input);
  const result: BenchmarkSeriesResult = {
    benchmark: input.benchmark,
    source: input.source,
    asOf: input.today,
    series,
  };
  cache.set(key, result);
  return result;
}

/** Test-only: clears the module-level cache between cases. */
export function clearBenchmarkCache(): void {
  cache.clear();
}
