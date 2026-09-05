import { describe, expect, it } from "vitest";
import { isRegexShapeSafe, MAX_LOOP_QUANTIFIERS } from "@/lib/regex-safety";
import { safeCompileRegex } from "@/lib/rules-engine";

/**
 * FF-06. The reviewer's reproduction: `^a*a*a*a*a*a*!$` passed the old guard
 * (no groups, so nothing to inspect) and then took over two seconds on a
 * 280-character subject. These tests pin the restricted language that replaced
 * it: the shape is rejected up front, and everything still accepted finishes in
 * bounded time on the longest subject the rules engine can hand it.
 */
describe("isRegexShapeSafe", () => {
  it("rejects the reported catastrophic pattern", () => {
    expect(isRegexShapeSafe("^a*a*a*a*a*a*!$")).toBe(false);
    expect(safeCompileRegex("^a*a*a*a*a*a*!$")).toBeNull();
  });

  it("rejects two adjacent loops that can match the same character", () => {
    for (const pattern of [
      "a*a*",
      "a*a+",
      "x+x*",
      "\\d+[0-9]*",
      "\\w*\\d+",
      ".*.*",
      "[abc]*[bcd]+",
      "(?:ab)*(?:ab)+",
      "a{2,4}a{2,4}",
    ]) {
      expect(isRegexShapeSafe(pattern), pattern).toBe(false);
    }
  });

  it("allows loops separated by a mandatory atom, which bounds the split points", () => {
    for (const pattern of [".*Eats.*", "\\d+-\\d+", "^AMZN.*MKTP$", "a*b a*"]) {
      expect(isRegexShapeSafe(pattern), pattern).toBe(true);
    }
  });

  it("allows adjacent loops over disjoint character sets", () => {
    for (const pattern of ["\\d+\\s*", "[a-z]+#*", "\\s*\\d+"]) {
      expect(isRegexShapeSafe(pattern), pattern).toBe(true);
    }
  });

  it("caps the total number of loops so the polynomial degree stays bounded", () => {
    const withinCap = ".*a.*b.*c$";
    const overCap = ".*a.*b.*c.*d$";
    expect(withinCap.split("*").length - 1).toBe(MAX_LOOP_QUANTIFIERS);
    expect(isRegexShapeSafe(withinCap)).toBe(true);
    expect(isRegexShapeSafe(overCap)).toBe(false);
  });

  it("still rejects the ambiguous quantified groups the old guard caught", () => {
    for (const pattern of [
      "(a+)+",
      "(a*)*",
      "(a+){2,}",
      "([a-z]+){2,5}",
      "(a|aa)+",
      "(?:a+)+",
      "((a+))+",
      "((a|b))+",
      "^(a?a?)+$",
      "(a?)+",
    ]) {
      expect(isRegexShapeSafe(pattern), pattern).toBe(false);
    }
  });

  it("accepts the merchant patterns the settings UI actually suggests", () => {
    for (const pattern of [
      "^(AMZN|Amazon).*Mktp",
      "^Uber(\\s*Eats)?$",
      "^[a-z0-9_-]+$",
      "(foo)+",
      "(?:bar)+x",
      "(foo\\+bar)+",
      "starbucks",
      "^ACH \\w+ \\d+$",
      "^\\d{4}-\\d{2}$",
      "SQ \\*COFFEE",
    ]) {
      expect(safeCompileRegex(pattern), pattern).toEqual(expect.objectContaining({ test: expect.any(Function) }));
    }
  });

  it("expands a small range exactly but widens an enormous one", () => {
    // [a-z] and [0-9] are disjoint, so this stays allowed.
    expect(isRegexShapeSafe("[a-z]+[0-9]*")).toBe(true);
    // Overlapping ranges are still caught.
    expect(isRegexShapeSafe("[a-z]+[c-f]*")).toBe(false);
    // A range too wide to enumerate falls back to matching everything.
    expect(isRegexShapeSafe("[\u0000-\uffff]+#*")).toBe(false);
    // A reversed range is nonsense; treat it as unanalyzable.
    expect(isRegexShapeSafe("[z-a]+#*")).toBe(false);
  });

  it("treats an unanalyzable atom conservatively rather than accepting it", () => {
    // A negated class and \W could match anything, so they overlap everything.
    expect(isRegexShapeSafe("[^x]*a*")).toBe(false);
    expect(isRegexShapeSafe("\\W*\\S*")).toBe(false);
  });

  it("ignores zero-width assertions when deciding adjacency", () => {
    expect(isRegexShapeSafe("^\\d+$")).toBe(true);
    expect(isRegexShapeSafe("\\ba+\\b")).toBe(true);
    // Anchors between two overlapping loops do not make them safe.
    expect(isRegexShapeSafe("a*\\ba*")).toBe(false);
  });

  it("rejects unbalanced groups instead of guessing at their shape", () => {
    expect(isRegexShapeSafe("(abc")).toBe(false);
    expect(isRegexShapeSafe("abc)")).toBe(false);
  });

  it("handles a lazy quantifier the same way as its greedy twin", () => {
    expect(isRegexShapeSafe("a*?a*?")).toBe(false);
    expect(isRegexShapeSafe("a*?b")).toBe(true);
  });

  it("treats a malformed brace as a literal rather than a quantifier", () => {
    expect(isRegexShapeSafe("a{bc")).toBe(true);
    expect(isRegexShapeSafe("a{x,y}")).toBe(true);
  });

  it("compares literals against a class from either side", () => {
    // Literal on the left, class on the right, and the reverse.
    expect(isRegexShapeSafe("[5]*\\d*")).toBe(false);
    expect(isRegexShapeSafe("\\d*[5]*")).toBe(false);
    // \\d is a subset of \\w, so they overlap; \\s is disjoint from both.
    expect(isRegexShapeSafe("\\d*\\w*")).toBe(false);
    expect(isRegexShapeSafe("\\w*\\s*")).toBe(true);
    expect(isRegexShapeSafe("\\s*\\s*")).toBe(false);
  });

  it("handles an escape at the very end of a pattern", () => {
    // A dangling backslash has no escaped character to inspect. The shape is
    // harmless either way; the RegExp constructor is what rejects the syntax.
    expect(isRegexShapeSafe("abc\\")).toBe(true);
    expect(safeCompileRegex("abc\\")).toBeNull();
    // An unterminated class swallows the rest of the pattern and widens to
    // "matches anything"; compilation is what reports the real syntax error.
    expect(isRegexShapeSafe("[abc\\")).toBe(true);
    expect(safeCompileRegex("[abc\\")).toBeNull();
  });

  it("reads an escaped character inside a class as its own set", () => {
    expect(isRegexShapeSafe("[\\d]+[0-9]*")).toBe(false);
    expect(isRegexShapeSafe("[\\-]+#*")).toBe(true);
  });

  it("treats a literal ] in first position as a member, not the terminator", () => {
    expect(isRegexShapeSafe("[]]+x")).toBe(true);
  });

  it("finishes fast on the longest subject the rules engine can supply", () => {
    // The engine truncates merchant/name/account text at 300 characters.
    const subject = "a".repeat(280) + "?";
    const worstAccepted = safeCompileRegex(".*a.*b.*c$")!;
    const started = performance.now();
    worstAccepted.test(subject);
    expect(performance.now() - started).toBeLessThan(250);
  });
});
