# Frontend Comprehensive Spec: Mobile Responsiveness, Component/Data-Viz Enhancements, and Accessibility Audit

Date: 2026-09-01
Scope: Mobile Responsiveness, Data-Viz/Component Enhancements, Full-Repo UI/UX & A11y Audit

## 1. Overview & Objectives

This specification addresses three foundational frontend pillars across FundFlow:
1. **Mobile Responsiveness**: Eliminate horizontal scroll leaks, optimize touch-target hitboxes (>=44x44px on mobile), and provide mobile-first bottom sheets on phone viewports.
2. **Component & Data-Viz Enhancements**: Modernize chart table-twins with token-compliant styling, wire dialog focus trapping into `GoalWizard`, and consolidate modal overlays (`CustomizeDrawer`, `SeedBudgetButton`, `AddTransactionModal`, `AddManualHoldingForm`) onto the shared `Modal` primitive.
3. **Accessibility & Design System Audit**: Validate ARIA contracts (`aria-current="true"` on filter toggles, combobox / listbox discipline, dialog focus trapping), guarantee keyboard focus rings (`focus-visible:outline-2`), and eliminate raw non-token border/color classes across all chart and table surfaces.

---

## 2. Requirements & Changes

### Pillar 1: Mobile Responsiveness Polish Across Key Views
- **Dashboard (`DashboardToolbar.tsx`, `MonthChips.tsx`)**:
  - `MonthChips.tsx`: Add `aria-current={active ? "true" : undefined}` on month filter chips; ensure horizontal scrollbar is hidden with `scrollbar-none` and touch padding is preserved.
  - `DashboardToolbar.tsx`: Set `aria-current={active ? "true" : undefined}` (in-page filter selection rather than page navigation).
- **Budget (`BudgetTable.tsx`)**:
  - Add `focus-visible:outline-2 rounded-field` to the "Show/Hide unbudgeted" toggle button.
  - Maintain horizontal scrollability on table viewports with minimum 640px table width.
- **Reports (`ReportTransactions.tsx`)**:
  - Replace raw `border-black/5 dark:border-white/10` with semantic token `border-panel-border`.
  - Ensure pagination links maintain `min-h-11` touch targets.
- **Transactions (`TransactionQueryControls.tsx`)**:
  - Replace manual backdrop elements with `<PopoverBackdrop onClose={...} />`.
- **Settings (`SettingsSectionPicker.tsx`)**:
  - Add `focus-visible:outline-2` to the mobile `<select>` dropdown.

### Pillar 2: Component & Data-Viz Enhancements
- **Data-Viz Charts (`SankeyChart.tsx`, `TrendChart.tsx`, `DivergingColumns.tsx`, `CumulativeCompareChart.tsx`)**:
  - Replace `border-black/5 dark:border-white/10` in all table twins with `border-panel-border`.
  - Wrap table twins in `overflow-x-auto` to prevent narrow-viewport overflow.
- **Goal Wizard (`GoalWizard.tsx`)**:
  - Wire `useDialogFocus` into `<dialog>` to enforce focus management, Tab trapping, and Escape key dismissal.
- **Modal Overlay Consolidation**:
  - `CustomizeDrawer.tsx`: Refactor from bare `<dialog>` to `<Modal placement="sheet">` with `titleId="customize-widgets-title"`.
  - `SeedBudgetButton.tsx`: Refactor from bare `<dialog>` to `<Modal>` with `titleId="budget-proposal-title"`.
  - `AddTransactionModal.tsx`: Pass `placement="sheet"` to `<Modal>` for mobile full-bleed sheet.
  - `AddManualHoldingForm.tsx`: Pass `placement="sheet"` to `<Modal>` for mobile full-bleed sheet.

### Pillar 3: Accessibility & Design Tokens
- **Focus Rings**:
  - Verify every interactive button, link, and control includes `focus-visible:outline-2` without raw `outline-none` suppression.
- **Semantic ARIA**:
  - Ensure `aria-current="true"` is applied to active filter items on in-page views.
  - Ensure progress bars carry proper `role="progressbar"` or `role="img"`.
- **Token Fidelity**:
  - Guarantee 100% token conformance: all background, text, and border utilities derive from CSS variables.

---

## 3. Verification Criteria
- `npm test`: 100% pass across all unit and integration test suites.
- `npm run lint`: 0 ESLint errors and warnings.
- `npm run typecheck`: 0 TypeScript type errors.
- Scan tests assert that no `border-black` or raw colors bypass tokens.
