import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("roadmap route and UI wiring", () => {
  it("adds route handlers for import review, AI insights, takeout, sessions, and audit", () => {
    for (const file of [
      "app/api/import/preview/route.ts",
      "app/api/import/commit/route.ts",
      "app/api/ai/insights/route.ts",
      "app/api/export/takeout/route.ts",
      "app/api/settings/sessions/route.ts",
      "app/api/settings/audit/route.ts",
    ]) {
      expect(existsSync(file), `${file} should exist`).toBe(true);
      expect(readFileSync(file, "utf8")).toContain("requireUser");
    }
  });

  it("adds settings panels for audit, sessions, passkeys, and household mode", () => {
    for (const file of [
      "components/settings/AuditLogSection.tsx",
      "components/settings/SessionsSection.tsx",
      "components/settings/PasskeysSection.tsx",
      "components/settings/HouseholdSection.tsx",
    ]) {
      expect(existsSync(file), `${file} should exist`).toBe(true);
    }

    const settings = readFileSync("app/settings/page.tsx", "utf8");
    expect(settings).toContain("AuditLogSection");
    expect(settings).toContain("SessionsSection");
    expect(settings).toContain("PasskeysSection");
    expect(settings).toContain("HouseholdSection");
  });

  it("adds a PWA manifest and offline shell", () => {
    expect(existsSync("app/manifest.ts")).toBe(true);
    expect(existsSync("public/sw.js")).toBe(true);
    expect(readFileSync("app/layout.tsx", "utf8")).toContain("/sw.js");
  });
});
