# Repository review, high-volume check, and colour palettes (2026-09-24)

Branch: `claude/repo-review-ui-polish-vh0x9b`.
Scope: a bug and consistency review, a page-by-page UI pass, a high-volume data pass, and user-selectable colour palettes.

## How it was verified

Every authenticated page was rendered in Chromium against a local `supabase start` stack with all migrations applied.
Two users were used:

| User | Data | Why |
| --- | --- | --- |
| `demo@example.com` | The built-in demo dataset: 2 accounts, 507 transactions | The shape screenshots and baselines are usually taken at |
| `large@example.com` | Demo plus 23,259 transactions over 18 months (3,176 in the current month, 374 on one checking account), 14 accounts, 400 merchants including very long names, 250 split transactions, 400 card payments, 300 refunds, 12 budgets, 8 goals, 180 days of balance snapshots | The volume at which layouts that look fine on demo data fall apart |

Both users were captured on all 22 routes at 1440px and 390px wide in light and dark mode (176 captures), checking HTTP status, console and page errors, and horizontal overflow.
The final sweep was clean on all four.
Automated gates at the final commit: `npm run lint`, `npx tsc --noEmit`, `npm run test:unit` (5,358 tests), `npm run validate:palette`, `npm run build`.
The Playwright e2e suite was not run: it needs its own credentials, and its browser build does not match the one installed here.

## Bugs fixed

| # | Where | Symptom | Cause and fix |
| --- | --- | --- | --- |
| 1 | `proxy.ts` | Sign-in impossible against a local `supabase start` stack | The CSP hardcoded `https://` for the Supabase host. Loopback http URLs now get http/ws sources and no `upgrade-insecure-requests`; hosted projects are unchanged. |
| 2 | Every `.in()` read | Cash Flow, Budget, Forecasting, Advice, Wrapped, Goals and Dashboard returned 414 on a self-hosted stack | 250-UUID chunks built ~9.3KB request lines, over nginx/Kong's 8KB default. One `IN_FILTER_CHUNK_SIZE` (150, `lib/postgrest-limits.ts`) now covers every URL list. |
| 3 | `lib/dashboard.ts` | Split transactions could silently vanish from category totals in a busy month | The month's split read was one unchunked `.in()` whose error was ignored. It is chunked and throws. |
| 4 | Forecast chart | Axis read $4K / -$6K / -$16K and never marked zero | Ticks were nice steps offset by the raw minimum. `niceTickRange()` puts every tick on a round multiple. |
| 5 | Monthly review | The same warning appeared three times | Duplicate and large-charge prompts had no date or amount, so different days read identically. |
| 6 | Demo data | A second user could not load demo data | Transaction ids were not user-scoped, but `plaid_transaction_id` is unique across all users. |
| 7 | Demo data | "Recent" demo purchases dated in the future | The current month drew days 1-28; dates after today are now clamped to today. |
| 8 | Error logging | Supabase failures logged as `[object Object]` | PostgREST errors are plain objects. `errorMessage()` reads `message` and `code`, never `details`, which can echo row values. |
| 9 | Settings → Display | Theme, density, reduced motion and default blur were saved but never applied | Nothing read `profiles.display_prefs`. `DisplayPrefsApplier` applies all four, and the theme select applies immediately. |

## High-volume findings

The dashboard ledger strip, the surface that previously broke at volume, held up.
It aggregated 370 entries into one mark per day, with the label budget intact.
Two small improvements: each day mark now has a hover summary with its full count and totals, because a busy day's label names only its largest entry.
The account picker also no longer inherits the eyebrow's letter-spacing.

Other surfaces did break at volume and were fixed:

- **Reports Sankey.** Unbounded, it drew every expense group and every category in it, leaving a column of hairline, unlabelled slivers.
  Groups now fold to the seven colour slots plus "Everything else".
  Each group keeps up to three categories, and any under 8% of the group fold into "Smaller categories".
  Income sources cap at five.
  The diagram is about 35% shorter on the large user, and every node is readable.
- **Cash Flow trend.** At 12 months, the period labels ran together into one string. Labels now thin to what fits and always keep the latest period. The left gutter also fits negative values.
- **Accounts.** Every row drew the same 30-day curve twice, because the page loads only the selected range. The long trend now appears only when it covers more.
- **Budget.** Planned amounts showed as bare numbers ("3200") beside formatted currency, and sat 10px below the rest of the row. They now carry a currency prefix and line up.

Load times on the large user in the dev server were 2 to 5 seconds per page, and about 10 seconds for `/transactions`.
Production builds are faster, but `/transactions` is the one to watch if the ledger grows further.

## UI consistency pass

- Dates and table headers no longer use Geist Mono; tabular sans figures instead, as `globals.css` already intended.
- `titleCase` keeps joining words lowercase ("Food and Drink") and initialisms upper-case ("Roth IRA").
- One `RouteErrorView` for all four error boundaries, with a way back to the dashboard.
- Title Case page names (Debt Payoff, Receipt Inbox), sentence-case buttons, formatted dates instead of raw ISO dates and month keys.
- The sidebar fits a 900px window, and a lone "Mine" scope switch is hidden without a household.
- Milestone badges read "Net worth" and "Emergency fund", and none uses danger red.
- 404 page, admin header, notifications column alignment, matching login dividers, readable Advice topic list.

## Colour palettes

Ten light and ten dark palettes, chosen independently in Settings → Display, with live swatch previews.
The command palette also has a "Color themes" entry.

| Light | Mood | Dark | Mood |
| --- | --- | --- | --- |
| Ember (default) | Warm orange on paper | Ember (default) | Warm orange on charcoal |
| Ocean | Clear blue | Midnight | Navy night, electric blue |
| Forest | Fresh greens | Evergreen | Pine shadows, mint glow |
| Orchid | Soft violet | Aubergine | Plum dusk, lavender |
| Rose | Bold pink-red | Rosewood | Velvet red, rose neon |
| Sunflower | Golden | Espresso | Roasted brown, gold |
| Lagoon | Tropical teal | Abyss | Deep sea, teal glow |
| Indigo | Deep ink blue | Arctic | Polar night, frost blue |
| Graphite | Monochrome | Obsidian | True black, cyan edge |
| Sakura | Blossom pink | Synthwave | Retro neon magenta |

How it works: `lib/themes.ts` is the single source of truth for the injected CSS, the picker, and the tests.
The mode (`data-theme`) still chooses light or dark.
`data-palette-light` and `data-palette-dark` choose each mode's palette.
They are applied pre-paint from localStorage (only ids from the list are accepted), and `DisplayPrefsApplier` reconciles them with the profile so the choice follows the user across devices.

Guard rails: a palette changes background, panels, borders and the accent family only.
It never changes a `--viz-*` chart slot or a success/danger/warning token.
`tests/unit/themes.test.ts` fails any palette where:

- accent text, body text, muted text, or semantic text is under 4.5:1 on any of its surfaces;
- primary-button text is under 4.5:1 on either gradient stop;
- any chart slot has weaker contrast against its panel than on the default palette.

Beyond the palettes, the look now carries each palette's mood through a soft accent glow behind the page, gradient primary buttons, an accent edge on the active nav item, and a slightly larger page title.

## Not done

- Charts drawn in a fixed SVG viewBox still render small axis text on phones; the table twins carry the numbers.
- Density "Compact" scales the whole UI by 93.75% rather than tightening individual components.
- Dependency majors (ESLint 10, TypeScript 7) are left for a separate change.
