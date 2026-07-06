import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requireUser, requireAdmin, errorResponse, badRequest } from "@/lib/http";

const mockGetUser = vi.fn();
const mockSingle = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

const mockSupabaseClient = {
  auth: {
    getUser: mockGetUser,
  },
  from: mockFrom,
};

vi.mock("@/lib/supabase/server", () => {
  return {
    createClient: async () => mockSupabaseClient,
  };
});

describe("badRequest", () => {
  it("returns 400 response with the error message", async () => {
    const resp = badRequest("Invalid query parameter");
    expect(resp.status).toBe(400);
    const json = await resp.json();
    expect(json.error).toBe("Invalid query parameter");
  });
});

describe("errorResponse", () => {
  let logErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const logModule = await import("@/lib/log");
    logErrorSpy = vi.spyOn(logModule, "logError").mockImplementation(() => {});
  });

  afterEach(() => {
    logErrorSpy.mockRestore();
  });

  it("returns 500 response and logs error context", async () => {
    const err = new Error("DB Connection failed");
    const resp = errorResponse("test.db", err);
    expect(resp.status).toBe(500);

    const json = await resp.json();
    expect(json.error).toBe("DB Connection failed");
    expect(logErrorSpy).toHaveBeenCalledWith("test.db", err);
  });
});

describe("requireUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if user is not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const result = await requireUser();
    expect(result).toBeInstanceOf(Response); // NextResponse is subclass of Response
    const resp = result as Response;
    expect(resp.status).toBe(401);
    const json = await resp.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns user and supabase client on success", async () => {
    const mockUser = { id: "user-123", email: "test@example.com" };
    mockGetUser.mockResolvedValue({ data: { user: mockUser } });

    const result = await requireUser();
    expect(result).not.toBeInstanceOf(Response);
    const { user, supabase } = result as { user: { id: string }; supabase: unknown };
    expect(user.id).toBe("user-123");
    expect(supabase).toBe(mockSupabaseClient);
  });
});

describe("requireAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if requireUser fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const result = await requireAdmin();
    expect(result).toBeInstanceOf(Response);
    const resp = result as Response;
    expect(resp.status).toBe(401);
  });

  it("returns 403 if profile role is not admin", async () => {
    const mockUser = { id: "user-123", email: "test@example.com" };
    mockGetUser.mockResolvedValue({ data: { user: mockUser } });

    // Mock supabase.from("profiles").select("role").eq("id", user.id).single()
    mockSingle.mockResolvedValue({ data: { role: "member" } });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });

    const result = await requireAdmin();
    expect(result).toBeInstanceOf(Response);
    const resp = result as Response;
    expect(resp.status).toBe(403);
    const json = await resp.json();
    expect(json.error).toBe("Forbidden");

    expect(mockFrom).toHaveBeenCalledWith("profiles");
    expect(mockSelect).toHaveBeenCalledWith("role");
    expect(mockEq).toHaveBeenCalledWith("id", "user-123");
  });

  it("returns user and supabase client if profile role is admin", async () => {
    const mockUser = { id: "admin-123", email: "admin@example.com" };
    mockGetUser.mockResolvedValue({ data: { user: mockUser } });

    mockSingle.mockResolvedValue({ data: { role: "admin" } });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });

    const result = await requireAdmin();
    expect(result).not.toBeInstanceOf(Response);
    const { user, supabase } = result as { user: { id: string }; supabase: unknown };
    expect(user.id).toBe("admin-123");
    expect(supabase).toBe(mockSupabaseClient);
  });
});
