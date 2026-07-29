export interface BenchmarkSeries {
  symbol: string;
  name: string;
  points: { date: string; closePrice: number }[];
}

export const S_AND_P_500_BENCHMARK: BenchmarkSeries = {
  symbol: "SPY",
  name: "S&P 500 ETF Trust",
  points: [
    { date: "2026-01-01", closePrice: 480.0 },
    { date: "2026-04-01", closePrice: 505.0 },
    { date: "2026-07-01", closePrice: 540.0 },
  ],
};
