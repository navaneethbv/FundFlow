import { describe, it, expect } from "vitest";
import { SETTINGS_SECTIONS } from "@/components/settings/settings-nav";

describe("components/settings/settings-nav.ts", () => {
  it("defines unique section keys and descriptions", () => {
    const keys = new Set<string>();
    for (const sec of SETTINGS_SECTIONS) {
      expect(keys.has(sec.key)).toBe(false);
      keys.add(sec.key);
      expect(sec.label.length).toBeGreaterThan(0);
      expect(sec.description.length).toBeGreaterThan(0);
    }
  });
});
