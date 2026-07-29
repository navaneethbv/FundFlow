import { describe, it, expect, vi } from "vitest";

const mockCreateClient = vi.fn().mockReturnValue({ auth: {} });
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { createServiceClient } from "@/lib/supabase/service";

describe("lib/supabase/service", () => {
  it("creates a privileged service client with autoRefreshToken and persistSession set to false", () => {
    const client = createServiceClient();
    expect(client).toBeDefined();
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  });
});
