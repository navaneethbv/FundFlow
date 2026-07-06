import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("interaction polish", () => {
  it("uses shared button variants for repeated action controls", () => {
    for (const file of [
      "components/ConnectBankButton.tsx",
      "components/RefreshButton.tsx",
      "components/LogoutButton.tsx",
      "components/settings/ReconnectBankButton.tsx",
    ]) {
      expect(readFileSync(file, "utf8")).toContain("@/components/ui/Button");
    }
  });
});
