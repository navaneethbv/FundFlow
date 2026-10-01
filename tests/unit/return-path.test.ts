import { expect, it } from "vitest";
import { safeReturnPath } from "@/lib/return-path";
it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/%2fevil.test", "/%5cevil.test", "/%0aevil", "/login", "javascript:alert(1)", "%", null])("rejects unsafe return target %s", (path) => {
  expect(safeReturnPath(path)).toBe("/dashboard");
});
it("preserves an invitation across login", () => {
  expect(safeReturnPath("/household/accept?token=abc")).toBe("/household/accept?token=abc");
});
