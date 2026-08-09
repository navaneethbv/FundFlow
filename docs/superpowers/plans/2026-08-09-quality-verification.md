# Quality and Verification Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the approved dark categorical palette, close the remaining browser-journey gaps, establish deterministic visual baselines, and finish PR #99 with local, live, browser, and remote evidence.

**Architecture:** A repository-owned palette validator guards perceptual separation, shared Playwright fixtures freeze authenticated application state, feature journeys protect behavior, and a final visual suite captures stable full-page baselines only after all feature work lands.

**Tech Stack:** Next.js 16.2, React 19, CSS custom properties, TypeScript 6, Node.js, Vitest 4, Playwright 1.61, GitHub Actions, CodeQL, SonarCloud, and Vercel.

## Global Constraints

The work remains on `fix/shipped-defects` and PR #99.
The light categorical palette and positive and negative diverging tokens remain unchanged.
Color is never the sole carrier of meaning.
Visual baselines are generated only after every feature slice is complete.
Local verification, live Supabase state, browser acceptance, and remote checks are reported separately.

---

### Task 1: Own and test the categorical palette validator

**Files:**

- Create: `scripts/validate_palette.js`
- Create: `tests/unit/palette-validator.test.ts`
- Modify: `package.json`

**Interfaces:** Produces importable `validatePalette`, `deltaE2000`, and CVD simulation helpers plus an `npm run validate:palette` command.

- [ ] Write failing tests for hex parsing, OKLab reference distances, protanopia, deuteranopia, tritanopia simulation, exact threshold boundaries, and readable failure output.
- [ ] Add fixtures proving the approved light and dark palettes pass and an intentionally collapsed palette fails.
- [ ] Run `npm run test:unit -- tests/unit/palette-validator.test.ts` and confirm failure.
- [ ] Implement deterministic sRGB conversion, canonical Machado simulation matrices, OKLab conversion, and pair enumeration without a runtime dependency.
- [ ] Enforce a normal-vision floor of 15 and a protanopia and deuteranopia floor of 6 for every pair in each theme, while reporting tritanopia as advisory evidence.
- [ ] Add a package script that validates repository token values and exits nonzero with the failing theme, simulation, pair, and distance.
- [ ] Run unit tests and the CLI and commit with `test(ui): add palette accessibility validator`.

### Task 2: Apply the approved dark palette

**Files:**

- Modify: `app/globals.css`
- Modify: chart render tests selected with `rg -- '--viz-'`
- Modify: `CLAUDE.md` if it records the shipped palette

**Interfaces:** Fixes dark tokens in order to `#9f12a0`, `#a457ef`, `#2c94b0`, `#8e5223`, `#449546`, `#544ec5`, and `#cb5790`.

- [ ] Write or update failing token tests for the exact approved values and unchanged light and diverging tokens.
- [ ] Run the palette and chart tests and confirm the old dark values fail.
- [ ] Replace only the seven dark categorical tokens.
- [ ] Verify every chart still has direct labels, a legend, or a table twin and add coverage where a chart lacks a non-color cue.
- [ ] Run `npm run validate:palette`, affected chart tests, and `git diff --check`.
- [ ] Commit with `fix(ui): complete dark categorical palette`.

### Task 3: Establish shared deterministic browser fixtures

**Files:**

- Create: `tests/e2e/fixtures/authenticated.ts`
- Create: `tests/e2e/fixtures/seed.ts`
- Modify: `playwright.config.ts`
- Modify: existing E2E helpers selected during implementation

**Interfaces:** Produces credentialed fixtures with frozen user data, dates, motion, theme, viewport, and cleanup plus a stable snapshot path template.

- [ ] Inventory existing authentication and seed helpers and write a failing smoke test for deterministic fixture setup and cleanup.
- [ ] Centralize shared setup without changing test semantics or embedding production credentials.
- [ ] Freeze time before application code starts, reduce motion, and wait on observable page state instead of fixed delays.
- [ ] Configure stable snapshot paths keyed by browser project, route, theme, and viewport.
- [ ] Preserve the existing Chromium project and retry behavior while making local and CI artifacts comparable.
- [ ] Run the smoke and existing transaction E2E suites twice and commit with `test(e2e): add deterministic authenticated fixtures`.

### Task 4: Close primary-page E2E gaps

**Files:**

- Create: `tests/e2e/dashboard.spec.ts`
- Create: `tests/e2e/settings.spec.ts`
- Create: `tests/e2e/investments.spec.ts`
- Create: `tests/e2e/goals.spec.ts`
- Modify: feature E2E files added by the deferred, debt, sinking, duplicate, and MFA plans

**Interfaces:** Covers Dashboard, Settings, Investments, Goals, Debt, Receipts, Sinking Funds, and Duplicate Review as credentialed end-user journeys.

- [ ] Add Dashboard coverage for hide, reorder, reload persistence, grouped budgets, investment day change, and top movers.
- [ ] Add Settings coverage for OFX preview, sinking cadence, passkey availability messaging, and multiple TOTP-factor management.
- [ ] Add Investments coverage for range change, allocation and performance states, and primary table interactions.
- [ ] Add Goals coverage for create or edit behavior, shipped illustrations, progress states, and mobile layout.
- [ ] Run every new feature journey separately, reproduce and fix any end-user-visible defect, and retain focused regression coverage.
- [ ] Run the combined new journey set twice without retries and commit with `test(e2e): cover remaining primary journeys`.

### Task 5: Perform the responsive interaction pass

**Files:**

- Modify: components and tests only where this pass reproduces a defect
- Modify: `docs/QA.md`

**Interfaces:** Verifies 375, 430, 768, and desktop widths in both themes, with desktop sidebar and user-menu states and mobile navigation states.

- [ ] Inspect every primary route at all four widths in light and dark modes.
- [ ] Inspect desktop expanded and collapsed sidebar states and an open user menu.
- [ ] Inspect mobile primary navigation and the complete destination sheet.
- [ ] Reject and fix horizontal overflow, clipped popovers, unreachable controls, targets below 44 pixels, low-contrast focus states, browser exceptions, same-origin request failures, and application console errors.
- [ ] Inspect every categorical chart for palette use and redundant non-color labeling.
- [ ] Add a focused regression test for each defect fixed during the pass.
- [ ] Run affected unit and E2E tests twice and commit with `fix(ui): complete responsive interaction pass`.

### Task 6: Capture final visual baselines

**Files:**

- Create: `tests/e2e/visual-baseline.spec.ts`
- Create mechanically: Playwright snapshot files under the configured snapshot directory
- Modify: `.gitignore` only if the intended snapshot directory is currently ignored

**Interfaces:** Captures deterministic full-page baselines for primary authenticated routes in light and dark themes.

- [ ] Define the exact primary route matrix after all feature pages exist and exclude operating-system WebAuthn prompts.
- [ ] Write visual assertions that wait for stable route-specific content and mask only nondeterministic third-party or secret-bearing regions.
- [ ] Generate baselines locally in the same browser version used by CI.
- [ ] Review every baseline manually for layout, clipping, spacing, typography, data visibility, empty states, and chart labels.
- [ ] Run the visual suite twice without updating snapshots and confirm zero diffs.
- [ ] Commit the reviewed baselines with `test(visual): add authenticated page baselines`.

### Task 7: Complete the PR-wide verification gate

**Files:**

- Modify: `docs/HANDOFF.md`
- Modify: `docs/TODO.md`
- Modify: `docs/QA.md`
- Modify: PR #99 description and checklist through GitHub CLI

- [ ] Verify every new migration is applied to the linked Supabase project in order and run its verification SQL.
- [ ] Run `npm run validate:palette`, `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm test`, `npm run build`, and `git diff --check`.
- [ ] Run the complete credentialed Playwright suite twice without retries and preserve failure artifacts if a run fails.
- [ ] Verify the production passkey ceremony on the canonical domain after deployment.
- [ ] Update handoff, roadmap, and QA evidence with migration ids, exact test totals, browser matrix, visual snapshot count, and any explicitly deferred external limitation.
- [ ] Commit with `docs: complete PR 99 verification record`.
- [ ] Push the branch, update PR #99, and watch GitHub Actions, CodeQL, SonarCloud, and Vercel checks to terminal status.
- [ ] Address every actionable failure, rerun the affected local gate, push the fix, and watch the replacement checks.
- [ ] Confirm the final worktree is clean and PR #99 contains every approved phase.
