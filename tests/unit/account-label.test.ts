import { describe, expect, it } from "vitest";
import { stripTrailingAccountMask } from "@/lib/account-label";

const EMAIL_MASK = "•*x";
const PDF_MASK = "•*x-";

describe("stripTrailingAccountMask", () => {
  it("strips a bullet or asterisk mask bound to the last four digits", () => {
    expect(stripTrailingAccountMask("Amex Platinum ••••1234", EMAIL_MASK)).toBe("Amex Platinum");
    expect(stripTrailingAccountMask("Amex Platinum •••• 1234", EMAIL_MASK)).toBe("Amex Platinum");
    expect(stripTrailingAccountMask("Chase Checking *1234", PDF_MASK)).toBe("Chase Checking");
    expect(stripTrailingAccountMask("Chase Checking ****1234", PDF_MASK)).toBe("Chase Checking");
  });

  // `x` is both a mask character and a letter. Consuming it unconditionally
  // rendered "Amex 1234" as "Ame" in the weekly report.
  it("does not take a trailing letter from the card name", () => {
    expect(stripTrailingAccountMask("Amex 1234", EMAIL_MASK)).toBe("Amex");
    expect(stripTrailingAccountMask("Chase Freedom Flex 1234", PDF_MASK)).toBe("Chase Freedom Flex");
    expect(stripTrailingAccountMask("Wells Fargo Max 1234", EMAIL_MASK)).toBe("Wells Fargo Max");
  });

  it("still treats an x mask as a mask where it is not part of a word", () => {
    expect(stripTrailingAccountMask("Card xx1234", EMAIL_MASK)).toBe("Card");
    expect(stripTrailingAccountMask("Amex xxxx1234", EMAIL_MASK)).toBe("Amex");
  });

  it("leaves four digits that are not a trailing mask alone", () => {
    expect(stripTrailingAccountMask("Plan 2024 Savings", EMAIL_MASK)).toBe("Plan 2024 Savings");
    expect(stripTrailingAccountMask("Checking", EMAIL_MASK)).toBe("Checking");
  });

  it("returns empty for a name that is nothing but a mask, so callers can fall back", () => {
    expect(stripTrailingAccountMask("1234", EMAIL_MASK)).toBe("");
    expect(stripTrailingAccountMask("••••1234", PDF_MASK)).toBe("");
  });
});
