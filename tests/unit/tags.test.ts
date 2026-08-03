import { describe, it, expect } from "vitest";
import { validateTagName, planTagRename } from "@/lib/tags";

describe("validateTagName", () => {
  it("accepts a normal name, trimmed", () => {
    expect(validateTagName("  travel  ")).toEqual({ ok: true, value: "travel" });
  });

  it("rejects a non-string", () => {
    expect(validateTagName(42).ok).toBe(false);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(validateTagName("").ok).toBe(false);
    expect(validateTagName("   ").ok).toBe(false);
  });

  it("rejects a name over 40 characters", () => {
    expect(validateTagName("a".repeat(41)).ok).toBe(false);
    expect(validateTagName("a".repeat(40)).ok).toBe(true);
  });
});

describe("planTagRename", () => {
  const existing = ["travel", "work", "gift"];

  it("plans a plain rename to a new, unused name", () => {
    const result = planTagRename("travel", "vacation", existing);
    expect(result).toEqual({ ok: true, value: { oldName: "travel", newName: "vacation", isMerge: false } });
  });

  it("plans a merge when the target name already exists", () => {
    const result = planTagRename("travel", "work", existing);
    expect(result).toEqual({ ok: true, value: { oldName: "travel", newName: "work", isMerge: true } });
  });

  it("rejects renaming a tag that does not exist", () => {
    expect(planTagRename("ghost", "vacation", existing).ok).toBe(false);
  });

  it("rejects renaming a tag to itself", () => {
    expect(planTagRename("travel", "travel", existing).ok).toBe(false);
  });

  it("rejects an invalid new name", () => {
    expect(planTagRename("travel", "", existing).ok).toBe(false);
  });

  it("rejects an invalid old name", () => {
    const result = planTagRename("", "vacation", existing);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("old name");
  });
});
