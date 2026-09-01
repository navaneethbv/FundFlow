import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanFileContents } from "./test-utils";

/**
 * Modal adoption (frontend-review R4b): every overlay surface renders the
 * modal dialog recipe — `<dialog open aria-modal aria-labelledby>` keyed
 * through useDialogFocus, either directly or via the shared `<Modal>` primitive.
 * A bare fixed overlay without dialog semantics is the regression this scan catches.
 */

const MODAL_PRIMITIVE = "components/ui/Modal.tsx";

const OVERLAY_SURFACES = [
  "components/transactions/AddTransactionModal.tsx",
  "components/transactions/TransactionEditor.tsx",
  "components/investments/AddManualHoldingForm.tsx",
  "components/dashboard/CustomizeDrawer.tsx",
  "components/budget/SeedBudgetButton.tsx",
];

describe("modal dialog discipline", () => {
  it("Modal primitive encapsulates dialog recipe and focus discipline", () => {
    const source = readFileSync(MODAL_PRIMITIVE, "utf8");
    expect(source).toContain("<dialog");
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("useDialogFocus");
  });

  it.each(OVERLAY_SURFACES)("%s uses dialog semantics or Modal primitive", (file) => {
    const source = readFileSync(file, "utf8");
    const usesModal = source.includes("<Modal") || source.includes("<dialog");
    expect(usesModal, `${file} must render <Modal> or <dialog>`).toBe(true);
  });

  it("no fixed overlay renders a bare panel without <dialog> or <Modal>", () => {
    const offenders = scanFileContents(
      "components",
      (source, file) =>
        !file.endsWith("components/ui/Modal.tsx") &&
        !file.endsWith("components/ui/PopoverBackdrop.tsx") &&
        /fixed\s+inset-0\s+(z-50|z-40)/.test(source) &&
        !source.includes("<dialog") &&
        !source.includes("<Modal"),
    );
    expect(
      offenders,
      `fixed overlays must render <dialog> or <Modal>: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
