import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { verifyStepUp } from "@/lib/step-up";

const password = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { signInWithPassword: password } })),
}));
const user = { email: "review@example.test" } as User;
const listFactors = vi.fn();
const challengeAndVerify = vi.fn();
const client = { auth: { mfa: { listFactors, challengeAndVerify } } } as unknown as SupabaseClient;

beforeEach(() => {
  vi.clearAllMocks();
  password.mockResolvedValue({ error: null });
  challengeAndVerify.mockResolvedValue({ error: new Error("Invalid code") });
});

describe("destructive action step-up", () => {
  it.each([
    { data: null, error: new Error("Auth unavailable") },
    { data: null, error: null },
    { data: {}, error: null },
  ])("never falls back to password when enrolled factors cannot be determined: %j", async (result) => {
    listFactors.mockResolvedValue(result);
    expect(await verifyStepUp(client, user, "password")).toBe(false);
    expect(password).not.toHaveBeenCalled();
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("accepts a valid code from the second verified authenticator without a selection", async () => {
    listFactors.mockResolvedValue({ data: { totp: [
      { id: "first", status: "verified" }, { id: "second", status: "verified" },
    ] }, error: null });
    challengeAndVerify.mockImplementation(async ({ factorId }) => ({
      error: factorId === "second" ? null : new Error("Invalid code"),
    }));
    expect(await verifyStepUp(client, user, "second-code")).toBe(true);
    expect(password).not.toHaveBeenCalled();
  });

  it("does not accept another factor's code when a particular factor is required", async () => {
    listFactors.mockResolvedValue({ data: { totp: [
      { id: "first", status: "verified" }, { id: "second", status: "verified" },
    ] }, error: null });
    expect(await verifyStepUp(client, user, "wrong-code", "second")).toBe(false);
    expect(challengeAndVerify).toHaveBeenCalledExactlyOnceWith({ factorId: "second", code: "wrong-code" });
    expect(password).not.toHaveBeenCalled();
  });

  it("rejects an unknown selected factor even when no factors are enrolled", async () => {
    listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    expect(await verifyStepUp(client, user, "password", "unknown")).toBe(false);
    expect(password).not.toHaveBeenCalled();
  });

  it("uses a separate password client only after a successful empty-factor lookup", async () => {
    const credential = crypto.randomUUID();
    listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    expect(await verifyStepUp(client, user, credential)).toBe(true);
    expect(password).toHaveBeenCalledExactlyOnceWith({ email: user.email, password: credential });
  });
});
