import { describe, it, expect, vi } from "vitest";

const mockCreateBrowserClient = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (...args: unknown[]) => mockCreateBrowserClient(...args),
}));

vi.mock("@/lib/env", () => ({
  publicEnv: {
    supabaseUrl: "https://mock-supabase-url.supabase.co",
    supabasePublishableKey: "mock-publishable-key",
  },
}));

import { createClient } from "@/lib/supabase/client";

describe("supabase browser client creator", () => {
  it("initializes createBrowserClient with environment values", () => {
    createClient();
    expect(mockCreateBrowserClient).toHaveBeenCalledWith(
      "https://mock-supabase-url.supabase.co",
      "mock-publishable-key",
    );
  });
});
