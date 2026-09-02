# Frontend Comprehensive Implementation Plan: Responsiveness, Data-Viz/Components, and A11y Audit

Date: 2026-09-01
Spec: [Frontend Multiverse Spec](../specs/2026-09-01-frontend-multiverse-spec.md)

## Task Breakdown

### Task 1: Chart Table-Twin Token Migration & Responsive Overflow
- Files to edit:
  - `components/charts/SankeyChart.tsx`
  - `components/charts/TrendChart.tsx`
  - `components/charts/DivergingColumns.tsx`
  - `components/charts/CumulativeCompareChart.tsx`
  - `components/reports/ReportTransactions.tsx`
- Replace `border-black/5 dark:border-white/10` with `border-panel-border`.

### Task 2: Modal Consolidation & Mobile Bottom-Sheet Layouts
- Files to edit:
  - `components/dashboard/CustomizeDrawer.tsx`: Refactor to `<Modal placement="sheet" titleId="customize-widgets-title">`.
  - `components/budget/SeedBudgetButton.tsx`: Refactor to `<Modal titleId="budget-proposal-title">`.
  - `components/transactions/AddTransactionModal.tsx`: Pass `placement="sheet"` to `<Modal>`.
  - `components/investments/AddManualHoldingForm.tsx`: Pass `placement="sheet"` to `<Modal>`.

### Task 3: Goal Wizard Dialog Focus Management
- Files to edit:
  - `components/goals/GoalWizard.tsx`: Import `useDialogFocus` and bind `onKeyDown={handleDialogKeyDown}` with `dialogRef`.

### Task 4: In-Page Filter ARIA & Touch Target Refinements
- Files to edit:
  - `components/dashboard/MonthChips.tsx`: Add `aria-current={active ? "true" : undefined}`.
  - `components/dashboard/DashboardToolbar.tsx`: Use `aria-current={active ? "true" : undefined}` for account filter links.
  - `components/budget/BudgetTable.tsx`: Add `focus-visible:outline-2 rounded-field` on unbudgeted toggle.
  - `components/transactions/TransactionQueryControls.tsx`: Replace raw backdrop buttons with `<PopoverBackdrop />`.
  - `components/settings/SettingsSectionPicker.tsx`: Add `focus-visible:outline-2` to mobile section select.

### Task 5: Testing & Quality Gate Verification
- Files to edit / create:
  - `tests/unit/frontend-multiverse-audit.test.ts`: Add test suite covering chart token conformance, Modal adoption in CustomizeDrawer & SeedBudgetButton, GoalWizard focus discipline, and filter ARIA attributes.
- Run `npm test`, `npm run lint`, and `npm run typecheck`.
