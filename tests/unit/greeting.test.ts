import { describe, it, expect } from "vitest";
import { resolveDisplayName, greetingWord } from "@/lib/greeting";

describe("resolveDisplayName", () => {
  it("prefers displayName over everything else", () => {
    expect(
      resolveDisplayName({ displayName: "Nav", fullName: "Navaneeth Rao", email: "nav@example.com" }),
    ).toBe("Nav");
  });

  it("falls back to fullName when displayName is absent", () => {
    expect(resolveDisplayName({ fullName: "Navaneeth Rao", email: "nav@example.com" })).toBe(
      "Navaneeth Rao",
    );
  });

  it("falls back to the local part of the email when both names are absent", () => {
    expect(resolveDisplayName({ email: "nav@example.com" })).toBe("nav");
  });

  it("treats blank strings the same as absent", () => {
    expect(
      resolveDisplayName({ displayName: "   ", fullName: "", email: "nav@example.com" }),
    ).toBe("nav");
  });

  it("falls back to a generic greeting when nothing is available", () => {
    expect(resolveDisplayName({})).toBe("there");
  });
});

describe("greetingWord", () => {
  it("says morning before noon", () => {
    expect(greetingWord(0)).toBe("morning");
    expect(greetingWord(11)).toBe("morning");
  });

  it("says afternoon from noon to before 6pm", () => {
    expect(greetingWord(12)).toBe("afternoon");
    expect(greetingWord(17)).toBe("afternoon");
  });

  it("says evening from 6pm onward", () => {
    expect(greetingWord(18)).toBe("evening");
    expect(greetingWord(23)).toBe("evening");
  });
});
