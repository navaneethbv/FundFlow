import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  UNAVAILABLE_BENCHMARK_PROVIDER,
  getCachedBenchmarkSeries,
  clearBenchmarkCache,
  type BenchmarkProvider,
} from "@/lib/benchmark-provider";

describe("UNAVAILABLE_BENCHMARK_PROVIDER", () => {
  it("resolves an empty series rather than throwing", async () => {
    const result = await UNAVAILABLE_BENCHMARK_PROVIDER.series({
      benchmark: "sp500",
      start: "2026-01-01",
      end: "2026-07-01",
    });
    expect(result).toEqual([]);
  });
});

describe("getCachedBenchmarkSeries", () => {
  beforeEach(() => {
    clearBenchmarkCache();
  });

  it("fetches once and reuses the cache for the same day, benchmark, and range", async () => {
    const seriesFn = vi.fn().mockResolvedValue([{ date: "2026-07-01", close: 100 }]);
    const provider: BenchmarkProvider = { series: seriesFn };

    const first = await getCachedBenchmarkSeries(provider, {
      benchmark: "sp500",
      start: "2026-07-01",
      end: "2026-07-30",
      source: "test-source",
      today: "2026-07-30",
    });
    const second = await getCachedBenchmarkSeries(provider, {
      benchmark: "sp500",
      start: "2026-07-01",
      end: "2026-07-30",
      source: "test-source",
      today: "2026-07-30",
    });

    expect(seriesFn).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.source).toBe("test-source");
    expect(first.asOf).toBe("2026-07-30");
  });

  it("refetches once the cached day is stale", async () => {
    const seriesFn = vi.fn().mockResolvedValue([]);
    const provider: BenchmarkProvider = { series: seriesFn };

    await getCachedBenchmarkSeries(provider, {
      benchmark: "us_bonds",
      start: "2026-07-01",
      end: "2026-07-30",
      source: "test-source",
      today: "2026-07-30",
    });
    await getCachedBenchmarkSeries(provider, {
      benchmark: "us_bonds",
      start: "2026-07-01",
      end: "2026-07-30",
      source: "test-source",
      today: "2026-07-31",
    });

    expect(seriesFn).toHaveBeenCalledTimes(2);
  });

  it("caches distinct benchmarks and ranges independently", async () => {
    const seriesFn = vi.fn().mockResolvedValue([]);
    const provider: BenchmarkProvider = { series: seriesFn };

    await getCachedBenchmarkSeries(provider, {
      benchmark: "sp500",
      start: "2026-07-01",
      end: "2026-07-30",
      source: "test-source",
      today: "2026-07-30",
    });
    await getCachedBenchmarkSeries(provider, {
      benchmark: "us_stocks",
      start: "2026-07-01",
      end: "2026-07-30",
      source: "test-source",
      today: "2026-07-30",
    });

    expect(seriesFn).toHaveBeenCalledTimes(2);
  });
});
