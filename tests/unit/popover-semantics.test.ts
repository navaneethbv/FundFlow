import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Popover semantics and focus return (frontend-review R7):
 * Surfaces with mixed controls (toggles, forms, inputs) are disclosure popovers,
 * not ARIA menus. They must not declare role="menu" / role="menuitem" / aria-haspopup="menu",
 * and must restore focus to their trigger on close/Escape.
 */

const POPOVER_FILES = [
  "components/shell/UserMenu.tsx",
  "components/ui/DropdownButton.tsx",
  "components/goals/GoalCardMenu.tsx",
  "components/budget/BudgetTable.tsx",
  "components/recurring/RecurringList.tsx",
];

describe("popover semantics and focus return", () => {
  it.each(POPOVER_FILES)("%s does not pretend to be an ARIA menu", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source, `${file} must not declare role="menu"`).not.toContain('role="menu"');
    expect(source, `${file} must not declare role="menuitem"`).not.toContain('role="menuitem"');
    expect(source, `${file} must not declare aria-haspopup="menu"`).not.toContain('aria-haspopup="menu"');
  });

  it.each(POPOVER_FILES)("%s restores focus to trigger ref on close/Escape", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source, `${file} must define a triggerRef`).toContain("triggerRef");
    const hasFocus = /triggerRef\.current\?\.focus\(\)/.test(source) || /usePopoverMenu/.test(source);
    expect(hasFocus, `${file} must focus triggerRef on Escape or close`).toBe(true);
  });
});
