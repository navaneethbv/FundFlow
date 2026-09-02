import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Frontend Multiverse: Chart Design Token Conformance", () => {
  const chartFiles = [
    "components/charts/SankeyChart.tsx",
    "components/charts/TrendChart.tsx",
    "components/charts/DivergingColumns.tsx",
    "components/charts/CumulativeCompareChart.tsx",
    "components/reports/ReportTransactions.tsx",
  ];

  it("ensures no chart or report table twin uses border-black or border-white classes", () => {
    for (const file of chartFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} should not contain raw border-black`).not.toContain("border-black");
      expect(source, `${file} should not contain raw border-white`).not.toContain("border-white");
      expect(source, `${file} should use border-panel-border`).toContain("border-panel-border");
    }
  });

  it("ensures SankeyChart FlowTable is wrapped in overflow-x-auto", () => {
    const source = readFileSync("components/charts/SankeyChart.tsx", "utf8");
    expect(source).toContain('<div className="overflow-x-auto">');
  });
});

describe("Frontend Multiverse: Modal Primitive Consolidation", () => {
  it("CustomizeDrawer uses Modal with sheet placement", () => {
    const source = readFileSync("components/dashboard/CustomizeDrawer.tsx", "utf8");
    expect(source).toContain('import Modal from "@/components/ui/Modal"');
    expect(source).toContain('placement="sheet"');
    expect(source).toContain('titleId="customize-widgets-title"');
    expect(source).not.toContain("fixed inset-0 z-50 flex items-center justify-center bg-black/50");
  });

  it("SeedBudgetButton uses Modal primitive", () => {
    const source = readFileSync("components/budget/SeedBudgetButton.tsx", "utf8");
    expect(source).toContain('import Modal from "@/components/ui/Modal"');
    expect(source).toContain('titleId="budget-proposal-title"');
    expect(source).not.toContain("fixed inset-0 z-50 flex items-center justify-center bg-black/50");
  });

  it("AddTransactionModal and AddManualHoldingForm use placement sheet", () => {
    const txnSource = readFileSync("components/transactions/AddTransactionModal.tsx", "utf8");
    expect(txnSource).toContain('placement="sheet"');

    const holdingSource = readFileSync("components/investments/AddManualHoldingForm.tsx", "utf8");
    expect(holdingSource).toContain('placement="sheet"');
  });
});

describe("Frontend Multiverse: GoalWizard Focus Management", () => {
  it("GoalWizard binds useDialogFocus to its dialog element", () => {
    const source = readFileSync("components/goals/GoalWizard.tsx", "utf8");
    expect(source).toContain('import { useDialogFocus } from "@/lib/use-dialog-focus"');
    expect(source).toContain("useDialogFocus(dialogRef, open, cancel)");
    expect(source).toContain("onKeyDown={handleDialogKeyDown}");
    expect(source).toContain("ref={dialogRef}");
  });
});

describe("Frontend Multiverse: Filter & Navigation ARIA Contracts", () => {
  it("MonthChips sets aria-current on active month link", () => {
    const source = readFileSync("components/dashboard/MonthChips.tsx", "utf8");
    expect(source).toContain('aria-current={active ? "true" : undefined}');
  });

  it("DashboardToolbar sets aria-current on active account link", () => {
    const source = readFileSync("components/dashboard/DashboardToolbar.tsx", "utf8");
    expect(source).toContain('aria-current={selectedAccountId ? undefined : "true"}');
    expect(source).toContain('aria-current={active ? "true" : undefined}');
  });

  it("BudgetTable has focus-visible styling on unbudgeted toggle button", () => {
    const source = readFileSync("components/budget/BudgetTable.tsx", "utf8");
    expect(source).toContain("focus-visible:outline-2");
  });

  it("TransactionQueryControls uses PopoverBackdrop for date and filters popovers", () => {
    const source = readFileSync("components/transactions/TransactionQueryControls.tsx", "utf8");
    expect(source).toContain('import PopoverBackdrop from "@/components/ui/PopoverBackdrop"');
    expect(source).toContain('<PopoverBackdrop onClose={() => close("date")} />');
    expect(source).toContain('<PopoverBackdrop onClose={() => close("filters")} />');
  });

  it("SettingsSectionPicker select includes focus-visible:outline-2", () => {
    const source = readFileSync("components/settings/SettingsSectionPicker.tsx", "utf8");
    expect(source).toContain("focus-visible:outline-2");
  });
});
