import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Dialog discipline (frontend-review R4): one recipe — native `<dialog open
 * aria-modal>` keyed through useDialogFocus — and a focusable selector that
 * covers every control a dialog can contain.
 */
describe("useDialogFocus", () => {
  const source = readFileSync("lib/use-dialog-focus.ts", "utf8");

  it("exports its FOCUSABLE selector", () => {
    expect(source).toContain("export const FOCUSABLE");
  });

  it("selector covers links, textareas, and explicit tabindex, not just form controls", () => {
    expect(source).toContain("a[href]");
    expect(source).toContain("textarea:not([disabled])");
    expect(source).toContain('[tabindex]:not([tabindex="-1"])');
    expect(source).toContain("button:not([disabled])");
    expect(source).toContain("input:not([disabled])");
    expect(source).toContain("select:not([disabled])");
  });

  it("keeps Escape close and Tab cycling", () => {
    expect(source).toContain('"Escape"');
    expect(source).toContain('"Tab"');
    expect(source).toContain("shiftKey");
  });
});
