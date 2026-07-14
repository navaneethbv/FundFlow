import { describe, it, expect } from "vitest";
import { detectCardImage } from "@/lib/card-image";

describe("detectCardImage", () => {
  it("matches card artwork by mask first", () => {
    expect(detectCardImage(null, null, "9181")).toBe("/cards/chase-freedom-unlimited.webp");
    expect(detectCardImage("Amex Gold", null, "0366")).toBe("/cards/chase-sapphire-reserve.avif");
  });

  it("returns null if name contains goldman (even if gold is present)", () => {
    expect(detectCardImage("Goldman Sachs Gold Card", null, null)).toBeNull();
    expect(detectCardImage("goldman", "gold", null)).toBeNull();
  });

  it("matches by keyword successfully", () => {
    expect(detectCardImage("Blue Cash Preferred", null, null)).toBe("/cards/amex-blue-cash-preferred.avif");
    expect(detectCardImage("Amex Preferred Card", null, null)).toBe("/cards/amex-blue-cash-preferred.avif");
    expect(detectCardImage(null, "Gold Card", null)).toBe("/cards/amex-gold.avif");
    expect(detectCardImage("Platinum Card", null, null)).toBe("/cards/amex-platinum.avif");
    expect(detectCardImage("Amazon Prime Rewards", null, null)).toBe("/cards/chase-amazon-prime.avif");
    expect(detectCardImage("Freedom Unlimited", null, null)).toBe("/cards/chase-freedom-unlimited.webp");
    expect(detectCardImage("Chase Freedom", null, null)).toBe("/cards/chase-freedom.webp");
    expect(detectCardImage("Sapphire Reserve", null, null)).toBe("/cards/chase-sapphire-reserve.avif");
    expect(detectCardImage("Discover IT", null, null)).toBe("/cards/discover.png");
    expect(detectCardImage("Wells Fargo Active Cash", null, null)).toBe("/cards/wells-fargo-signature.png");
  });

  it("returns null if no keyword matches", () => {
    expect(detectCardImage("Random Bank Card", null, null)).toBeNull();
    expect(detectCardImage(null, null, null)).toBeNull();
    expect(detectCardImage(undefined, undefined, undefined)).toBeNull();
  });
});
