import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAll = vi.fn();
const mockSet = vi.fn();
const mockCookieStore = {
  getAll: mockGetAll,
  set: mockSet,
};

vi.mock("next/headers", () => {
  return {
    cookies: async () => mockCookieStore,
  };
});

const mockCreateServerClient = vi.fn();
vi.mock("@supabase/ssr", () => {
  return {
    createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
  };
});

import { createClient } from "@/lib/supabase/server";

describe("createClient Server client builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a server-side Supabase client with custom cookie handlers", async () => {
    mockCreateServerClient.mockReturnValue({ mockClient: true });

    const client = await createClient();
    expect(client).toEqual({ mockClient: true });

    // Verify createServerClient was called with the correct parameters
    expect(mockCreateServerClient).toHaveBeenCalled();
    const args = mockCreateServerClient.mock.calls[0];
    expect(args[0]).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
    expect(args[1]).toBe(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

    const config = args[2];
    expect(config.cookies).toBeDefined();

    // Verify getAll() cookie handler
    mockGetAll.mockReturnValue([{ name: "sb-auth", value: "token" }]);
    const cookiesReturned = config.cookies.getAll();
    expect(mockGetAll).toHaveBeenCalled();
    expect(cookiesReturned).toEqual([{ name: "sb-auth", value: "token" }]);

    // Verify setAll() cookie handler
    config.cookies.setAll([
      { name: "test-cookie", value: "val", options: { path: "/" } },
    ]);
    expect(mockSet).toHaveBeenCalledWith("test-cookie", "val", { path: "/" });

    // Verify setAll() handles read-only errors gracefully
    mockSet.mockImplementation(() => {
      throw new Error("Cannot set headers after they are sent to the client");
    });
    expect(() =>
      config.cookies.setAll([
        { name: "test-cookie-err", value: "val", options: {} },
      ]),
    ).not.toThrow();
  });
});
