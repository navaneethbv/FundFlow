import { afterEach, describe, it, expect, vi } from "vitest";

const mockCreateClient = vi.fn().mockReturnValue({ auth: {} });
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { createServiceClient } from "@/lib/supabase/service";

const originalSecretKey = process.env.SUPABASE_SECRET_KEY;

afterEach(() => {
  if (originalSecretKey === undefined) {
    delete process.env.SUPABASE_SECRET_KEY;
  } else {
    process.env.SUPABASE_SECRET_KEY = originalSecretKey;
  }
  mockCreateClient.mockClear();
});

describe("lib/supabase/service", () => {
  it("creates a privileged service client with autoRefreshToken and persistSession set to false", () => {
    process.env.SUPABASE_SECRET_KEY = "test-secret-key";
    const client = createServiceClient();
    expect(client).toBeDefined();
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          experimental: { passkey: true },
        },
      },
    );
  });
});
