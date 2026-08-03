import { describe, expect, it } from "vitest";
import {
  GOAL_TEMPLATES,
  goalTemplateBySlug,
  goalImageFor,
  goalImageAlt,
  isKnownGoalImageSlug,
} from "@/lib/goal-templates";

describe("lib/goal-templates", () => {
  it("exports a non-empty list of templates", () => {
    expect(GOAL_TEMPLATES.length).toBeGreaterThan(0);
  });

  it("goalTemplateBySlug returns template or null", () => {
    expect(goalTemplateBySlug(null)).toBeNull();
    expect(goalTemplateBySlug("emergency-fund")).not.toBeNull();
    expect(goalTemplateBySlug("emergency-fund")?.label).toBe("Emergency fund");
    expect(goalTemplateBySlug("unknown-slug")).toBeNull();
  });

  it("goalImageFor returns image path for known slug or null", () => {
    expect(goalImageFor(null)).toBeNull();
    expect(goalImageFor("emergency-fund")).toBe("/goals/emergency-fund.svg");
    expect(goalImageFor("invalid")).toBeNull();
  });

  it("goalImageAlt returns alt text or empty string", () => {
    expect(goalImageAlt(null)).toBe("");
    expect(goalImageAlt("car")).toContain("compact car");
    expect(goalImageAlt("unknown")).toBe("");
  });

  it("isKnownGoalImageSlug validates slug strings", () => {
    expect(isKnownGoalImageSlug("wedding")).toBe(true);
    expect(isKnownGoalImageSlug("not-a-slug")).toBe(false);
    expect(isKnownGoalImageSlug(123)).toBe(false);
    expect(isKnownGoalImageSlug(null)).toBe(false);
  });
});
