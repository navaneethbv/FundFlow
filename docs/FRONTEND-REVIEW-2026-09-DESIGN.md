# FundFlow frontend review — design decisions

Date: 2026-09-01 · Companion: [SPEC](./FRONTEND-REVIEW-2026-09-SPEC.md) ·
[PLAN](./FRONTEND-REVIEW-2026-09-PLAN.md)

This record explains *why* each change looks the way it does, so the next reviewer
doesn't have to reverse-engineer intent from diffs. FundFlow's design language is the
statement register (PR #134): a paper-ledger world — flat panels, hairline rules,
tabular numerals, a burnt-orange accent that behaves like ink. Every decision below is
that language applied to interaction, not a new direction.

## 1. Dialogs: one recipe, borrowed from the app itself

The register language already has a canonical modal: `CustomizeDrawer` — an overlay
`div` holding a native `<dialog open aria-modal aria-labelledby>` whose keydown is
delegated to `useDialogFocus` (focus first control on open, cycle Tab at the edges,
Escape closes). The defect was never the recipe; it was that seven of eight modals
never adopted it.

**Decisions**

- Native `<dialog open>` rather than `showModal()`: the app mounts modals inside React
  trees with explicit `fixed` positioning; `showModal()` would fight that with UA
  centering and top-layer behavior it can't opt out of. The pattern keeps styling
  authority in the register's classes while `<dialog>` supplies the semantics axe and
  screen readers look for.
- `useDialogFocus` owns all keyboard behavior for every modal. Its `FOCUSABLE`
  selector grows to include `a[href]`, `textarea`, and explicit `[tabindex]` — a
  dialog containing a link must trap the same way as one containing only inputs. The
  selector is exported because the source-level tests assert its coverage; that is the
  same convention `command-palette.test.ts` established for client-only interaction.
- Focus return to the trigger is *deliberately not* in the hook. Two of the eight
  modals (`TransactionSortMenu`) already restore focus with a trigger ref; the rest
  get it popover-by-popover in this milestone where the trigger is cheap to ref.
  Retrofitting focus return into the hook would change its signature for all current
  callers at once — more blast radius than value, so it stays a per-component
  concern until the hook grows a real API (e.g. an options object) in a later pass.

## 2. Skip link: the quiet register affordance

The skip link is styled the way the register does everything structural: invisible
until focused, then a solid `--accent` pill (`bg-accent text-accent-foreground`,
`rounded-field`, `min-h-11`) pinned to the top-left with a `z` above the sidebar. No
animation, no new token. It targets `#main-content`, an id both shells
(`AppShell`, `AuthShell`) now share, with `tabIndex={-1}` so the target actually
receives focus in Safari. One link in the root layout covers every route because both
shells — and only those shells — own the `<main>` landmarks.

## 3. Loading: the skeleton is a page of the ledger, not a spinner

Heavy routes previously navigated with either a stale page or a bare unstyled flash,
and the three existing skeletons dropped the sidebar mid-flight — the shell flickering
away and back is louder than any loading indicator. The design rule:

- **The shell never unmounts.** `RouteSkeleton` renders `AppShell` with the route's
  `active` id plus a skeleton body, so navigation reads as *content changing inside a
  stable frame* — exactly how a paper register behaves: the book stays bound, the
  entries arrive.
- **Skeletons are hairline placeholders, not motion.** `animate-pulse` on
  `--panel-2` blocks with `rounded-card`/`rounded-field`, echoing the page's real
  region proportions (header row, stat tiles, a register table). The global
  `prefers-reduced-motion` rule already freezes `animate-pulse`; nothing here needs
  JS.
- Skeleton shapes mirror each route's dominant register structure rather than one
  generic gray box, so the swap-in reads as arrival, not replacement.

## 4. Error boundary: the error page keeps the book's voice

`app/error.tsx` follows `app/budget/error.tsx` exactly — eyebrow, `.display` heading,
reassuring copy ("Your data was not changed"), one accent "Try again" button — because
error copy is part of the interface's voice, and the register already established that
voice. The root boundary is deliberately generic ("This view is temporarily
unavailable"): it can fire on any route, so it may not name the surface. Route-specific
`error.tsx` files, where they exist, keep naming theirs.

## 5. Combobox palette: ARIA follows the keyboard that already exists

The palette's keyboard model was already correct (type to filter, arrows to move a
highlight, Enter to activate). The ARIA was a costume: `role="listbox"` whose options
contained buttons — invalid, and a trap once focus entered the list. The fix makes the
markup tell the truth about the interaction:

- The input is a `role="combobox"` with `aria-expanded`, `aria-controls`, and
  `aria-activedescendant` — the canonical pattern for "one focus point, arrow-driven
  highlight". Focus never leaves the input, so typing always works.
- Options become `role="option"` elements with `aria-selected` and no interactive
  descendants. Clicking an option still activates it; the button element was only ever
  there for pointer users, and an option with a click handler serves them identically
  while keeping the listbox contract valid.
- The dialog participates in the shared Tab trap via `useDialogFocus`, with Escape
  ownership moved from the global window listener to the hook so there is exactly one
  Escape authority per modal.

## 6. Popovers: name what they are

A `role="menu"` promises arrow-key navigation, `menuitem` children, and typeahead.
`UserMenu` (settings link + two toggles + sign-out), `DropdownButton`, and the row
menus violate all three — worse, announcing "menu" and then not supporting menu
keyboard behavior actively misleads screen-reader users. The design call: these are
**disclosure popovers**, not menus. The register's own `TransactionSortMenu` already
showed the honest pattern: trigger with `aria-expanded`, panel labelled on its own
terms, Escape closes, focus returns to the trigger. `role="menu"` survives only where
the content truly is a command sequence — and none of the five offenders qualify.

## 7. Field errors: the ledger annotates the entry line

In a register, an error annotation sits directly under the entry it corrects. The
implementation matches that physical metaphor with the mechanics that make it real:
the annotation gets an id derived from the control (`${htmlFor}-error`), the control
points back with `aria-describedby`, and `aria-invalid` marks the entry itself. The
annotation carries `role="alert"` because async submission failures arrive long after
the user's last focus change — an unannounced error is a silent bounced entry. Fields
without an `htmlFor` (rare; legacy call sites) still get `role="alert"` but cannot be
programmatically associated — the render test documents that boundary rather than
hiding it.

## 8. Tokens: hardcoded color is unregistered ink

`text-red-600` and friends are the design-system equivalent of a transaction recorded
outside the ledger: the value shows up, but nothing reconciles. The semantic tokens
(`--danger`, `--success`, `--warning`) are the only color pairs the palette validator
proves readable in both themes, and `Panel`'s own `danger`/`success` tones already use
them — the `amber-500` warning tone was the primitive contradicting itself. The rule
going forward, enforced by a scan gate: **semantic color classes only**. Decorative
tints use the same tokens at low alpha (`bg-danger/10`), mirroring `Panel`'s existing
tone recipe, so light and dark themes inherit correctness instead of being patched
per-class.

## 9. What was deliberately left alone

- **No visual redesign.** Palette, type roles (`.eyebrow`, `.display`,
  `.metric-value`), radius, and shadow tokens are untouched; the only `globals.css`
  change is nothing — all token work reuses existing variables.
- **The chart system** keeps its table twins and `svgRole` conditioning; this
  milestone only wraps twin tables in scroll containers.
- **The data layer.** The ledger facet scans, client-fetch waterfalls, and dashboard
  round-trips are real findings but belong to a data-access pass with large-data QA,
  not to an interaction-hardening PR. They are specified in the deferral table with
  their evidence intact.
- **Sub-10px type** and live-region polish are real but risk bloating this PR's
  review surface; both are queued with concrete pointers in the spec.

## 10. Self-critique

The temptation this branch resisted: rebuilding the dialog system as a headless
component with a context provider, and swapping every overlay for `showModal()` at
once. Both would be architecturally tidier and both would have touched all eight
modals plus their tests in one sweep — the kind of change that looks small in review
and lands like the F10 token change did (every visual baseline red). The register's
own advice applies: remove one accessory. The shared hook got one honest fix
(the selector), the modals got the existing recipe, and the scan gates — not new
abstractions — are what keep the discipline from eroding.
