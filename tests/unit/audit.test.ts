import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const mockInsert = vi.fn();
const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: mockFrom }),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { writeAudit, getClientIp } from "@/lib/audit";

describe("lib/audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("writeAudit", () => {
    it("inserts audit row into audit_logs", async () => {
      mockInsert.mockResolvedValue({ error: null });

      await writeAudit({
        userId: "user-123",
        action: "login",
        metadata: { browser: "chrome" },
        ip: "127.0.0.1",
      });

      expect(mockFrom).toHaveBeenCalledWith("audit_logs");
      expect(mockInsert).toHaveBeenCalledWith({
        user_id: "user-123",
        action: "login",
        metadata: { browser: "chrome" },
        ip: "127.0.0.1",
      });
    });

    it("catches and logs errors without throwing", async () => {
      mockInsert.mockRejectedValue(new Error("DB insertion error"));

      await expect(
        writeAudit({
          userId: "user-123",
          action: "signup",
        }),
      ).resolves.toBeUndefined();

      expect(mockLogError).toHaveBeenCalledWith(
        "audit.write",
        expect.any(Error),
      );
    });
  });

  describe("getClientIp", () => {
    it("returns the IP from x-real-ip when present", () => {
      const req = {
        headers: new Headers({
          "x-real-ip": "203.0.113.195",
        }),
      } as unknown as NextRequest;

      expect(getClientIp(req)).toBe("203.0.113.195");
    });

    it("falls back to x-vercel-forwarded-for when x-real-ip is missing", () => {
      const req = {
        headers: new Headers({
          "x-vercel-forwarded-for": "198.51.100.1, 10.0.0.1",
        }),
      } as unknown as NextRequest;

      expect(getClientIp(req)).toBe("198.51.100.1");
    });

    it("ignores client-forgeable x-forwarded-for", () => {
      const req = {
        headers: new Headers({
          "x-forwarded-for": "203.0.113.99",
        }),
      } as unknown as NextRequest;

      expect(getClientIp(req)).toBeNull();
    });

    it("returns null if no trusted header is present", () => {
      const req = {
        headers: new Headers(),
      } as unknown as NextRequest;

      expect(getClientIp(req)).toBeNull();
    });
  });
});
