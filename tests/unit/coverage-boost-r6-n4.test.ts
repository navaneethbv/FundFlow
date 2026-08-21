import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) => NextResponse.json({ error: String(error) }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(() => Promise.resolve(true));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockApiTokenCreated = vi.fn<(...args: unknown[]) => unknown>();
const mockApiTokenRevoked = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/request-audit", () => ({
  requestAudits: {
    apiTokenCreated: (...args: unknown[]) => mockApiTokenCreated(...args),
    apiTokenRevoked: (...args: unknown[]) => mockApiTokenRevoked(...args),
  },
}));

import { POST as tokensPost, DELETE as tokensDelete } from "@/app/api/tokens/route";
import { clientStub } from "@/tests/fixtures/supabase-query";

function jsonRequest(body: unknown) {
  return { url: "https://x.local", json: async () => body } as unknown as NextRequest;
}

function rejectingJsonRequest() {
  return { url: "https://x.local", json: () => Promise.reject(new Error("json fail")) } as unknown as NextRequest;
}

describe("coverage boost r6 n4: tokens route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
  });

  describe("POST /api/tokens", () => {
    it("returns the auth response when not signed in", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await tokensPost(jsonRequest({ name: "CI" }));
      expect(res.status).toBe(401);
    });

    it("returns 429 when rate limited (L13 true, L14, B@13)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      mockCheckRateLimit.mockResolvedValue(false);
      const res = await tokensPost(jsonRequest({ name: "CI" }));
      expect(res.status).toBe(429);
      await expect(res.json()).resolves.toEqual({ error: "Too many tokens created today." });
      expect(mockCheckRateLimit).toHaveBeenCalledWith("api-token-mint:u1", 5, 24 * 3600);
    });

    it("rejects when json() rejects (L17 catch arrow, L19 true)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await tokensPost(rejectingJsonRequest());
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("A token name (≤80 chars) is required");
    });

    it("rejects a blank name", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await tokensPost(jsonRequest({ name: "   " }));
      expect(res.status).toBe(400);
    });

    it("rejects a name longer than 80 chars (L19 length side)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await tokensPost(jsonRequest({ name: "x".repeat(81) }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("A token name (≤80 chars) is required");
    });

    it("mints a token and stores only its hash (L27 false, L29, L31)", async () => {
      const supabase = clientStub({
        api_tokens: { data: { id: "tok1", name: "CI token", created_at: "2026-07-13" }, error: null },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tokensPost(jsonRequest({ name: "  CI token  " }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toMatch(/^fft_/);
      expect(body.token.length).toBeGreaterThan(30);
      expect(body.row).toEqual({ id: "tok1", name: "CI token", created_at: "2026-07-13" });
      const written = supabase.writtenTo("api_tokens") as { token_hash: string; name: string };
      expect(written.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(written.token_hash).not.toContain(body.token);
      expect(mockApiTokenCreated).toHaveBeenCalledWith(expect.any(Object), "u1", { name: "CI token" });
    });

    it("returns 500 when the insert fails (L27 true)", async () => {
      const supabase = clientStub({ api_tokens: { data: null, error: new Error("insert boom") } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tokensPost(jsonRequest({ name: "CI" }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("tokens.create", expect.any(Error));
    });
  });

  describe("DELETE /api/tokens", () => {
    it("returns the auth response when not signed in", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await tokensDelete(jsonRequest({ id: "tok1" }));
      expect(res.status).toBe(401);
    });

    it("rejects when json() rejects (L37 catch arrow, L38 true, B@38)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await tokensDelete(rejectingJsonRequest());
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Missing token id");
    });

    it("rejects a missing or empty id", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await tokensDelete(jsonRequest({ id: "" }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Missing token id");
    });

    it("revokes a token (L38 false, L45 false, L47, L49)", async () => {
      const supabase = clientStub({ api_tokens: { data: null, error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tokensDelete(jsonRequest({ id: "tok1" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      const written = supabase.writtenTo("api_tokens") as { revoked_at: string };
      expect(new Date(written.revoked_at).toISOString()).toBeTruthy();
      expect(mockApiTokenRevoked).toHaveBeenCalledWith(expect.any(Object), "u1", { id: "tok1" });
    });

    it("returns 500 when the revoke fails (L45 true)", async () => {
      const supabase = clientStub({ api_tokens: { data: null, error: new Error("revoke boom") } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tokensDelete(jsonRequest({ id: "tok1" }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("tokens.revoke", expect.any(Error));
    });
  });
});