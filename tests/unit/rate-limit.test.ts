import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRpc = vi.fn();
const mockSupabaseClient = {
  rpc: mockRpc,
};

vi.mock("@/lib/supabase/service", () => {
  return {
    createServiceClient: () => mockSupabaseClient,
  };
});

import { checkRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  let logErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const logModule = await import("@/lib/log");
    logErrorSpy = vi.spyOn(logModule, "logError").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    logErrorSpy.mockRestore();
  });

  it("returns true if RPC returns true", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    const result = await checkRateLimit("key1", 5, 60);
    expect(result).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_key: "key1",
      p_max: 5,
      p_window_seconds: 60,
    });
  });

  it("returns false if RPC returns false", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });

    const result = await checkRateLimit("key2", 5, 60);
    expect(result).toBe(false);
  });

  it("fails open (returns true) and logs when RPC returns a DB error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Database offline" } });

    const result = await checkRateLimit("key3", 5, 60);
    expect(result).toBe(true);
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("fails open (returns true) and logs when RPC method throws exception", async () => {
    mockRpc.mockRejectedValue(new Error("Network failure"));

    const result = await checkRateLimit("key4", 5, 60);
    expect(result).toBe(true);
    expect(logErrorSpy).toHaveBeenCalled();
  });
});
