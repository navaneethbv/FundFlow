import { describe, it, expect } from "vitest";
import {
  merchantBrandIcon,
  merchantLogoDataUri,
} from "@/lib/merchant-logos";

describe("merchantLogoDataUri", () => {
  it("resolves a curated merchant regardless of case and punctuation", () => {
    for (const name of ["Netflix", "NETFLIX", "netflix.com", " Netflix "]) {
      const uri = merchantLogoDataUri(name);
      expect(uri).not.toBeNull();
      expect(uri).toContain("data:image/svg+xml,");
      expect(uri).toContain("%23"); // brand color hex, URL-encoded
    }
  });

  it("matches aliases of the same brand", () => {
    expect(merchantBrandIcon("McDonald's")).toEqual(merchantBrandIcon("mcd"));
    expect(merchantBrandIcon("Chase Card")).toEqual(merchantBrandIcon("Chase"));
  });

  it("returns null for unknown merchants (initial-disc fallback)", () => {
    expect(merchantLogoDataUri("Corner Grocer")).toBeNull();
    expect(merchantLogoDataUri("")).toBeNull();
  });

  it("renders a brand-colored single path", () => {
    const icon = merchantBrandIcon("Spotify")!;
    expect(icon.hex).toMatch(/^[0-9A-F]{6}$/);
    expect(icon.path).toMatch(/^M/);
  });
});
