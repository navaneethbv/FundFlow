# Security, UI, and memory review, 2026-09-26

Reviewed the clean local `test/expand-code-coverage` checkout at `66f96bf`.
Publication uses `fix/security-ui-memory`, rebased onto current `main` at `c3e7828`.
[PR #184](https://github.com/navaneethbv/FundFlow/pull/184) contains the changes; hosted checks are pending.
This is a focused source and behavior review, not a claim that every route or production workflow has been audited.

## Confirmed findings and changes

| Area | Reproduction | Fix |
| --- | --- | --- |
| Dashboard memory | Inserting 2,000 distinct filter scopes retained all 2,000 entries; expired entries were removed only when the exact key was read again. | Retain at most 32 scopes, evict the least recently used entry, and sweep expired entries on every read and write. |
| Dashboard correctness | Categories/subcategories containing colons produced identical cache keys for different filters; the literal merchant `-` collided with the absent-merchant placeholder. | Encode the full scope as a JSON tuple with null for missing dimensions; keep owner identity separate and invalidate by exact owner. |
| Request memory | Upload routes parsed entire multipart bodies before enforcing file limits. | Count actual streamed bytes before parsing, reject oversized envelopes with 413, and cancel the upstream stream when the running limit is exceeded. |
| AI input and quota | Numeric, object, and array questions threw instead of returning a validation response; quota-exhausted requests still loaded financial rows. | Require a string question and enforce the daily quota after consent but before financial reads. |
| Command palette | After 25 ArrowDown presses, the selected command was outside the visible scroll area. | Scroll the selected option into view without moving input focus; keep the index nonnegative for empty results. |
| Browser test safety | Seven standalone suites and the shared privileged fixture created service clients without calling the isolated-database guard. | Share the existing guard with all eight entry points and invoke it before client construction. |
| Test reliability | Four scheduled-route tests failed because their September 25 fixture date had become the past. | Pin the fixture clock, preserve the timezone-specific regression, and restore real timers after every test. |

The request limit is enforced in application parsing; it is not a claim that a reverse proxy or framework never buffers request bytes earlier.
File size limits, authentication, consent, owner scoping, rate limits, and Plaid signature verification remain in place.

## API contracts

| Route | Envelope limit | Retained file/content rule |
| --- | --- | --- |
| `POST /api/ai/ask` | 4 KiB | Trimmed string, 1 to 300 characters |
| `POST /api/ai/receipt` | 6 MiB | Image at most 5 MiB |
| `POST /api/receipts` | 6 MiB | Image at most 5 MiB, normalized by the existing decoder |
| `POST /api/import/preview` | 3 MiB | File at most 2 MiB |
| `POST /api/import/csv` | 3 MiB | File at most 2 MiB |
| `POST /api/settings/profile` | 4 MiB | Avatar at most 3 MiB |
| `POST /api/plaid/webhook` (already on current main) | 256 KiB | Existing dedicated reader and signature/hash verification preserved |

Limits cover the complete envelope, including extra fields and multipart framing.
An oversized declared Content-Length is rejected before reading; an absent or misleading header cannot bypass the actual byte counter.
Malformed JSON or multipart input returns 400 with `Invalid request body`.
Valid request and response schemas are unchanged.
Import and AI tests now construct real request bodies rather than bypassing parsing with partial request stubs.

## Memory measurement

Measured on Node 24.18.1 in three fresh processes per version with explicit garbage collection before and after populating the cache.
The baseline source was read from `66f96bf`; the candidate used the working-tree source.
Each run inserted 2,000 distinct synthetic scopes, each holding 10,000 numeric values, under a ten-minute TTL so expiration could not distort the capacity comparison.

| Version | Retained scopes | Heap increase, MiB, three runs |
| --- | ---: | --- |
| Baseline | 2,000 | 153.07, 153.06, 153.07 |
| Candidate | 32 | 2.46, 2.46, 2.46 |

The synthetic retained-heap reduction is approximately 98.4 percent.
This does not measure production RSS, response latency, or database query savings.
Eviction can increase recomputation when more than 32 scopes are active.
Idle processes can retain up to 32 entries until the next cache operation or process teardown; no persistent timer was introduced.
The ceiling bounds entry count, not the byte size of an individual dashboard result.

## Dependency refresh

Ran `npx npm-check-updates` during the initial review and validated available patch updates.
Current main already includes the Next.js, ESLint config, Nodemailer, and type updates, along with newer React and other dependencies.
The final PR preserves those versions and updates Vitest and its coverage provider from 5.0.1 to 5.0.2.
The lockfile was regenerated with install scripts disabled.
Additional major toolchain upgrades were not attempted as part of this focused remediation; they are not claimed incompatible.
The dependency audit reports zero vulnerabilities.

## Verification

- Initial targeted regressions reproduced six failures: three AI input type failures, unlimited cache retention, and two cache identity collisions.
- A real Chromium component test reproduced the command-palette visibility failure before the fix.
- Six component browser checks pass at 375, 768, and 1440 pixels in light and dark themes, including arrow navigation, Enter activation, empty search, Tab trapping, Escape, focus restoration, page overflow, browser errors, and axe checks on the dialog.
- The component fixture renders the actual component and generated application CSS with synthetic commands and a navigation stub; it does not prove authenticated server rendering or full Supabase Auth behavior.
- Six signed-out browser smoke tests pass against a local production build, covering login routing, security headers, and API/export authentication walls.
- Both a standalone browser suite and a shared-fixture suite were deliberately run with synthetic credentials and no approved target; both refused before creating a privileged client.
- Final CI-style coverage run after rebasing onto `c3e7828`: `SUPABASE_SECRET_KEY= npm run test:coverage` passed 5,390 tests across 485 files, with 22 integration files and three individual tests skipped.
  The service credential was explicitly empty so this run could not exercise the live database suites.
- Coverage passed the unchanged repository thresholds: 98.47 percent statements, 96.18 percent branches, 98.57 percent functions, and 99.60 percent lines.
- Final `npm run lint`, `npm run typecheck`, and `npm run build` passed with Next.js 16.3.6.
- `npm run validate:palette` passed with its existing documented exceptions unchanged, `npm audit --audit-level=high` reported zero vulnerabilities, and `git diff --check` passed.
- Inspected the rendered phone command-palette screenshot after the fix; the selected row is visible and the input remains focused.
- Local production servers started for smoke verification were stopped after the checks.

The isolated component checks are wired into the existing browser CI workflow.
Graphify was refreshed; its optional SQL parser is unavailable, so that graph does not replace migration/source review.

## Remaining limits

No database migration was changed or applied.
No live financial data was mutated, external AI call made, backup restored, or production deployment performed.
Authenticated browser/database acceptance requires an approved disposable Supabase target and remains unverified.
Existing restore redesign and licensed benchmark-source requirements remain deferred in `docs/TODO.md`.
The disabled backup-restore endpoint still needs an archive envelope limit as part of that redesign before enablement.
Other JSON endpoints should be considered for incremental adoption of the bounded parser; this review does not assert a universal request-body limit.
The user subsequently authorized publication as a PR.
The rebase preserves the already-merged webhook body limit and its malformed-body behavior rather than replacing its reader.
Hosted checks and deployment are separate from the local verification recorded here.
