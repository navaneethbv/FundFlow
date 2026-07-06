import { describe, it, expect } from "vitest";
import { detectCardDesign } from "@/lib/card-design";

describe("detectCardDesign", () => {
  it("detects depository checking accounts", () => {
    const style = detectCardDesign("My Checking", "Checking Account", "depository", "checking");
    expect(style.bgGradient).toContain("emerald");
    expect(style.textColor).toBe("text-emerald-50");
  });

  it("detects Amex Gold cards", () => {
    const style = detectCardDesign("Amex Gold", "American Express Gold Card", "credit", "credit card");
    expect(style.displayName).toBe("Amex Gold");
    expect(style.network).toBe("amex");
    expect(style.bgGradient).toContain("#dfb957");
  });

  it("detects Amex Platinum cards", () => {
    const style = detectCardDesign("Platinum Card", "Amex Platinum", "credit", "credit card");
    expect(style.displayName).toBe("Amex Platinum");
    expect(style.network).toBe("amex");
    expect(style.bgGradient).toContain("#cbcbcb");
  });

  it("detects Sapphire Reserve cards", () => {
    const style = detectCardDesign("Sapphire Reserve", "Chase Sapphire Reserve", "credit", "credit card");
    expect(style.displayName).toBe("Sapphire Reserve");
    expect(style.bgGradient).toContain("#242731");
  });

  it("detects Sapphire Preferred cards", () => {
    const style = detectCardDesign("Sapphire Preferred", "Chase Sapphire Preferred", "credit", "credit card");
    expect(style.displayName).toBe("Sapphire Preferred");
    expect(style.bgGradient).toContain("#10306b");
  });

  it("detects Chase Freedom cards", () => {
    const style = detectCardDesign("Freedom Unlimited", "Chase Freedom", "credit", "credit card");
    expect(style.displayName).toBe("Chase Freedom");
    expect(style.bgGradient).toContain("#0575e6");
  });

  it("detects Apple cards", () => {
    const style = detectCardDesign("Apple Card", "Goldman Sachs Apple Card", "credit", "credit card");
    expect(style.displayName).toBe("Apple Card");
    expect(style.network).toBe("apple");
    expect(style.bgGradient).toContain("white");
  });

  it("detects Capital One Venture cards", () => {
    const style = detectCardDesign("Venture Card", "Capital One Venture", "credit", "credit card");
    expect(style.displayName).toBe("Capital One Venture");
    expect(style.bgGradient).toContain("#24416d");
  });

  it("detects generic Visa cards", () => {
    const style = detectCardDesign("Visa Signature", "Generic Visa", "credit", "credit card");
    expect(style.displayName).toBe("Visa Signature");
    expect(style.network).toBe("visa");
    expect(style.bgGradient).toContain("blue-900");
  });

  it("detects generic Mastercard cards", () => {
    const style = detectCardDesign("Mastercard Black", "Generic MC", "credit", "credit card");
    expect(style.displayName).toBe("Mastercard Black");
    expect(style.network).toBe("mastercard");
    expect(style.bgGradient).toContain("#a13c1a");
  });

  it("falls back to generic credit card design", () => {
    const style = detectCardDesign("Random Card", "Unknown Bank", "credit", "credit card");
    expect(style.displayName).toBe("Random Card");
    expect(style.network).toBe("generic");
    expect(style.bgGradient).toContain("slate-800");
  });
});
