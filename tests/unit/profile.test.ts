import { describe, it, expect } from "vitest";
import { validateProfilePatch } from "@/lib/profile";

const TODAY = "2026-07-30";

describe("validateProfilePatch", () => {
  it("accepts an empty patch (every field explicitly skipped)", () => {
    expect(validateProfilePatch({}, TODAY)).toEqual({
      ok: true,
      value: { fullName: undefined, displayName: undefined, birthday: undefined },
    });
  });

  it("accepts and trims valid text fields", () => {
    const result = validateProfilePatch({ fullName: "  Ada Lovelace  ", displayName: "Ada" }, TODAY);
    expect(result).toEqual({ ok: true, value: { fullName: "Ada Lovelace", displayName: "Ada", birthday: undefined } });
  });

  it("treats an explicit null as clearing the field", () => {
    const result = validateProfilePatch({ fullName: null }, TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.fullName).toBeNull();
  });

  it("treats blank text as clearing the field rather than rejecting it", () => {
    const result = validateProfilePatch({ displayName: "   " }, TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.displayName).toBeNull();
  });

  it("rejects an overlong full name", () => {
    expect(validateProfilePatch({ fullName: "a".repeat(121) }, TODAY).ok).toBe(false);
  });

  it("rejects an overlong display name", () => {
    expect(validateProfilePatch({ displayName: "a".repeat(81) }, TODAY).ok).toBe(false);
  });

  it("accepts a valid past birthday", () => {
    const result = validateProfilePatch({ birthday: "1990-05-01" }, TODAY);
    expect(result).toEqual({ ok: true, value: { fullName: undefined, displayName: undefined, birthday: "1990-05-01" } });
  });

  it("accepts a null birthday as clearing it", () => {
    const result = validateProfilePatch({ birthday: null }, TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.birthday).toBeNull();
  });

  it("rejects a malformed birthday", () => {
    expect(validateProfilePatch({ birthday: "05/01/1990" }, TODAY).ok).toBe(false);
  });

  it("rejects a future birthday", () => {
    expect(validateProfilePatch({ birthday: "2026-08-01" }, TODAY).ok).toBe(false);
  });

  it("rejects a birthday more than 130 years ago", () => {
    expect(validateProfilePatch({ birthday: "1800-01-01" }, TODAY).ok).toBe(false);
  });
});
