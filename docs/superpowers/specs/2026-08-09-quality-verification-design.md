# FundFlow Quality and Verification Completion Design

## Scope

This design completes Phase A5 and Phases B2 through B4 inside PR #99.
Phase A, Phase B1, and the transaction-specific browser journey are already implemented on the branch and remain unchanged except where the final visual pass finds a genuine defect.

## Dark categorical palette

Dark mode uses a fully re-stepped seven-slot palette.
The slots are fixed in this order:

1. `--viz-1: #77a9ea`
2. `--viz-2: #55c795`
3. `--viz-3: #f1a824`
4. `--viz-4: #299525`
5. `--viz-5: #755efd`
6. `--viz-6: #d57c75`
7. `--viz-7: #d33ea7`

An earlier re-step (`#9f12a0`, `#a457ef`, `#2c94b0`, `#8e5223`, `#449546`, `#544ec5`, `#cb5790`) cleared every pairwise gate and was superseded, because it put `--viz-1`, `--viz-4`, and `--viz-6` at 2.33:1, 2.56:1, and 2.48:1 against the dark panel: below WCAG 1.4.11's 3:1 non-text minimum.
Pairwise separation and surface contrast are independent properties, and the validator was measuring only the first.
The set above clears both, with a worst-case surface contrast of 3.62:1, and does so at the light palette's own OKLCH hues, so the light and dark hue correspondence is preserved rather than abandoned.

The light palette remains unchanged.
The positive and negative diverging tokens remain separate from the categorical set.
No eighth categorical hue will be introduced.

The repository will own a deterministic palette validator under `scripts/validate_palette.js` so validation no longer depends on an unavailable external skill file.
The validator preserves the canonical skill methodology: an OKLab distance times 100 normal-vision floor of 15 and a simulated protanopia and deuteranopia floor of 6 for every pair.
It additionally gates every slot at a 3:1 WCAG 1.4.11 contrast ratio against its own theme's panel, which is what the first re-step attempt failed undetected.
Light `--viz-2` and `--viz-3` sit below that floor on white and are carried as two named exceptions, because a saturated aqua and a yellow cannot reach 3:1 on `#ffffff` without abandoning the V0 identity; the exception list is a ratchet and must never be extended to make a re-step pass.
It reports tritanopia separation in both light and dark modes as advisory evidence because the canonical validator does not gate on it.
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
