import { describe, it, expect } from "vitest";
import {
  SETTINGS_SECTIONS,
  sectionFromParam,
  parseDisplayPrefs,
  validateDisplayPrefsPatch,
  DEFAULT_DISPLAY_PREFS,
} from "@/components/settings/settings-nav";

describe("sectionFromParam", () => {
  it("defaults to profile when absent", () => {
    expect(sectionFromParam(undefined)).toBe("profile");
  });

  it("defaults to profile for an unknown section", () => {
    expect(sectionFromParam("ghost")).toBe("profile");
  });

  it("accepts every defined section key", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(sectionFromParam(section.key)).toBe(section.key);
    }
  });

  it("takes the first value from a repeated param", () => {
    expect(sectionFromParam(["security", "data"])).toBe("security");
  });

  it("has unique keys and non-empty labels and hints", () => {
    const keys = new Set<string>();
    for (const section of SETTINGS_SECTIONS) {
      expect(keys.has(section.key)).toBe(false);
      keys.add(section.key);
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("parseDisplayPrefs", () => {
  it("returns defaults for null, non-object, or empty input", () => {
    expect(parseDisplayPrefs(null)).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(parseDisplayPrefs("nonsense")).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(parseDisplayPrefs({})).toEqual(DEFAULT_DISPLAY_PREFS);
  });

  it("parses a fully valid stored preference set", () => {
    const stored = { theme: "dark", density: "compact", defaultPrivacyBlur: true, reducedMotion: "reduce" };
    expect(parseDisplayPrefs(stored)).toEqual(stored);
  });

  it("falls back per-field for an invalid value instead of rejecting the whole object", () => {
    const result = parseDisplayPrefs({ theme: "purple", density: "compact" });
    expect(result.theme).toBe("system");
    expect(result.density).toBe("compact");
  });
});

describe("validateDisplayPrefsPatch", () => {
  it("accepts an empty patch", () => {
    expect(validateDisplayPrefsPatch({})).toEqual({ ok: true, value: {} });
  });

  it("accepts a partial, valid patch", () => {
    expect(validateDisplayPrefsPatch({ theme: "dark" })).toEqual({ ok: true, value: { theme: "dark" } });
  });

  it("rejects a non-object body", () => {
    expect(validateDisplayPrefsPatch(null).ok).toBe(false);
    expect(validateDisplayPrefsPatch("dark").ok).toBe(false);
    expect(validateDisplayPrefsPatch([]).ok).toBe(false);
  });

  it("rejects an invalid theme rather than substituting a default", () => {
    expect(validateDisplayPrefsPatch({ theme: "purple" }).ok).toBe(false);
  });

  it("rejects an invalid density", () => {
    expect(validateDisplayPrefsPatch({ density: "cozy" }).ok).toBe(false);
  });

  it("rejects a non-boolean defaultPrivacyBlur", () => {
    expect(validateDisplayPrefsPatch({ defaultPrivacyBlur: "yes" }).ok).toBe(false);
  });

  it("rejects an invalid reducedMotion", () => {
    expect(validateDisplayPrefsPatch({ reducedMotion: "always" }).ok).toBe(false);
  });
});
