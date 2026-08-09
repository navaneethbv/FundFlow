# FundFlow Quality and Verification Completion Design

## Scope

This design completes Phase A5 and Phases B2 through B4 inside PR #99.
Phase A, Phase B1, and the transaction-specific browser journey are already implemented on the branch and remain unchanged except where the final visual pass finds a genuine defect.

## Dark categorical palette

Dark mode will use a fully re-stepped seven-slot palette rather than preserving the previous light and dark hue correspondence.
The slots are fixed in this order:

1. `--viz-1: #9f12a0`
2. `--viz-2: #a457ef`
3. `--viz-3: #2c94b0`
4. `--viz-4: #8e5223`
5. `--viz-5: #449546`
6. `--viz-6: #544ec5`
7. `--viz-7: #cb5790`

The light palette remains unchanged.
The positive and negative diverging tokens remain separate from the categorical set.
No eighth categorical hue will be introduced.

The repository will own a deterministic palette validator under `scripts/validate_palette.js` so validation no longer depends on an unavailable external skill file.
The validator will enforce a normal-vision CIEDE2000 floor of 15 and a simulated color-vision-deficiency floor of 6 for every pair.
It will validate protanopia, deuteranopia, and tritanopia simulations in both light and dark modes.
Every chart will retain direct labels, a legend, or a table twin because passing color separation does not make color the sole carrier of meaning.

## Browser verification

The browser pass will run after every feature slice is implemented so the final snapshots represent the actual PR.
The pass will cover 375, 430, 768, and desktop widths in light and dark modes.
Desktop checks will include expanded and collapsed sidebar states and an open user menu.
Mobile checks will include the primary navigation and the full destination sheet.

The pass will reject horizontal overflow, clipped popovers, unreachable controls, controls below the 44 pixel target floor, low-contrast focus states, browser exceptions, same-origin request failures, and application console errors.
Visual inspection will include every chart that consumes a categorical token.

## End-to-end coverage

The transaction journey from PR #98 already satisfies the originally listed Transactions gap and will not be duplicated.
New credentialed journeys will cover Dashboard, Settings, Investments, Goals, Debt, Receipts, Sinking Funds, and Duplicate Review.
Feature-specific journeys may live with their feature slice, but all of them must pass together during the final verification phase.

The Dashboard journey will cover hide, reorder, reload, persistence, budget group rows, investment day change, and top movers.
The Settings journey will cover OFX preview, sinking-fund cadence, passkey availability messaging, and multiple TOTP-factor management.
The Investments and Goals journeys will protect the existing visual rebuilds and their primary interactions.
The Debt journey will reconcile avalanche and snowball totals against deterministic fixtures.
The Receipts journey will cover upload, signed viewing, candidate attachment, ignore, restore, delete, and cross-user denial.
The Duplicate Review journey will cover dismissal, confirmation, projection exclusion, and undo without deleting either synced row.

## Visual snapshots

Playwright will capture deterministic full-page baselines for the primary authenticated routes in both themes.
The fixture setup will freeze user data, dates, motion, and viewport so snapshots do not depend on the current clock or live sync timing.
Passkey browser prompts and other operating-system-owned surfaces will not be image-snapshotted.
The surrounding application states for passkey enrollment and errors will be covered by component tests and manual production verification.

## Operational verification

The final local gate is TypeScript, lint, unit tests, complete Vitest, production build, credentialed Playwright, palette validation, and `git diff --check`.
Every migration added by the program must be applied to the linked Supabase project in order and followed by its verification SQL before reading code is published.
GitHub Actions, CodeQL, SonarCloud, and Vercel preview checks must pass on the final PR head.
The final handoff will report local verification, live database state, browser acceptance, and remote checks separately.

