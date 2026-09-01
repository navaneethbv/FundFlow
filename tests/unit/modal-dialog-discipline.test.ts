import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Modal adoption (frontend-review R4b): every overlay surface renders the
 * CustomizeDrawer recipe — `<dialog open aria-modal aria-labelledby>` keyed
 * through useDialogFocus. A bare fixed overlay without dialog semantics is
 * the regression this scan exists to catch.
 */

const MUST_USE_DIALOG = [
  "components/transactions/AddTransactionModal.tsx",
  "components/transactions/TransactionEditor.tsx",
  "components/investments/AddManualHoldingForm.tsx",
  "components/dashboard/CustomizeDrawer.tsx",
  "components/budget/SeedBudgetButton.tsx",
];

describe("modal dialog discipline", () => {
  it.each(MUST_USE_DIALOG)("%s uses the dialog recipe", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source, `${file} must render <dialog`).toContain("<dialog");
    expect(source, `${file} must be aria-modal`).toContain("aria-modal");
    expect(source, `${file} must label its dialog`).toContain("aria-labelledby");
    expect(source, `${file} must route keyboard through useDialogFocus`).toContain(
      "useDialogFocus",
    );
  });

  it("no fixed overlay renders a bare panel without <dialog>", () => {
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = `${dir}/${entry}`;
        if (statSync(full).isDirectory()) {
          if (entry.startsWith("_")) continue;
          walk(full);
        } else if (entry.endsWith(".tsx")) {
          const source = readFileSync(full, "utf8");
          if (source.includes("fixed inset-0 z-50") && !source.includes("<dialog")) {
            offenders.push(full);
          }
        }
      }
    }
    walk("components");
    expect(
      offenders,
      `fixed overlays must render <dialog: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
