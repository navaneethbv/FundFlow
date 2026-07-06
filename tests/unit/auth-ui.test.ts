import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("auth UI restyle", () => {
  it("uses AuthShell on auth and 404 routes", () => {
    for (const file of ["app/login/page.tsx", "app/signup/page.tsx", "app/not-found.tsx"]) {
      expect(readFileSync(file, "utf8")).toContain("AuthShell");
    }
  });

  it("renders MFA as six digit boxes while preserving verify flow", () => {
    const source = readFileSync("components/LoginForm.tsx", "utf8");

    expect(source).toContain("digitRefs");
    expect(source).toContain("handleDigitChange");
    expect(source).toContain("Array.from({ length: 6 })");
    expect(source).toContain("supabase.auth.mfa.verify");
  });

  it("uses shared form/button primitives on auth forms", () => {
    const joined = [
      readFileSync("components/LoginForm.tsx", "utf8"),
      readFileSync("components/SignupForm.tsx", "utf8"),
      readFileSync("components/GoogleSignInButton.tsx", "utf8"),
    ].join("\n");

    expect(joined).toContain("Field");
    expect(joined).toContain("Input");
    expect(joined).toContain("Button");
    expect(joined).toContain("buttonVariants");
  });
});
