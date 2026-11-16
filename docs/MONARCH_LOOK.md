# Monarch look and feel reference

A measured description of how Monarch's web app looks, and how each part maps onto FundFlow.
It is the visual target for FundFlow's chrome: shell, surfaces, type, and controls.

Captured 2026-11-16 from the live app in dark mode, in a 1920 x 903 CSS-pixel viewport, by reading computed styles in the browser.
Every number below is a computed value, not an estimate from a screenshot, unless it is marked "observed".
Light mode was not captured, because switching it means changing a setting on the account.

What this document does not do:

- It holds no account data. Amounts, merchants, and account names seen during capture are left out.
- It does not license Monarch's assets. The logo, the "Oracle" typeface, the icon font, and the illustrations are theirs and are not copied.
  FundFlow keeps its own mark, uses Geist, and uses lucide icons.
- It does not override FundFlow's own rules. Where the reference conflicts with an accessibility gate or a chart rule, the gate wins and the gap is listed under "Deliberate differences".

## 1. Design character

Monarch reads as calm and dense at the same time.
Five choices produce that, and they matter more than any single hex value:

1. **Tone, not lines, separates things.** The page is one near-black; cards are one step lighter; hover and selection are one step lighter again. Cards have no border.
2. **Two weights.** Almost everything is 400 or 500. There is no bold body text, and headings are 500.
3. **One accent, used sparingly.** Orange appears on the primary button, the active header tab, the AI link, and nowhere else in the chrome. Selection in the sidebar is neutral grey.
4. **Edge-to-edge layout.** Content fills the window with a 16px gutter. There is no centred max-width column.
5. **Rectangles for actions, pills for choices.** Buttons and inputs have an 8px radius. Only segmented toggles and status chips are fully round.

## 2. Colour

### 2.1 Surfaces (dark)

| Role | Value | Where it appears |
| --- | --- | --- |
| Page | `#191918` | body, sidebar, top bar |
| Card | `#222221` | every card, secondary buttons, select triggers |
| Raised / selected | `#2a2a28` | active sidebar item, date-group rows in tables, active segmented pill inside a card, neutral chips |
| Raised 2 | `#3b3a37` | progress-bar track, active segmented pill on the page colour |
| Hairline inside a card | `#2a2a28` | card header rule, row dividers (0.5px on a 2x display) |
| Control border | `#3b3a37` | secondary buttons |
| Control border, strong | `#494846` | select triggers, the pressed half of a joined button pair |
| Modal scrim | `rgba(0,0,0,0.5)` | behind the transaction drawer |

### 2.2 Text (dark)

| Role | Value |
| --- | --- |
| Primary | `#ffffff` |
| Sidebar labels, button labels | `#eeeeec` |
| Secondary (subtitles, column heads, axis labels, idle icons) | `#989691` |

### 2.3 Accent and semantic

| Role | Value | Notes |
| --- | --- | --- |
| Brand orange | `#ff692d` | primary button fill, active tab text and underline, "New" badge |
| AI gradient | `linear-gradient(178deg, #e5484d 20%, #ff692d 80%)` | clipped to text on "AI Assistant" and "Your Weekly Recap" |
| Link / tertiary action | `#23afd0` | "Download CSV", "View N transactions" |
| Selected settings row | text `#4ccce6` on `#003848` | the only teal fill in the app |
| Positive | text `#3dd68c`, bar `#30a46c` | income, remaining budget, gains |
| Negative | text `#ff9592`, bar `#e5484d` | over budget, losses |
| Warning | amber, observed | "At risk" chip, overdue dates |
| Disabled primary | `#ff692d` at 50% | a form's submit button before anything has changed |

Plain expenses are **not** red.
In the transaction list an outflow is plain white with no sign, and only inflows are coloured (green, with a leading `+`).

## 3. Typography

Family: `Oracle, sans-serif`, loaded at 400, 500, and bold.
Root size 16px, body line height 24px, no letter-spacing anywhere.

| Role | Size / line / weight | Colour |
| --- | --- | --- |
| Page title (top bar) | 18 / 24-27 / 500 | primary |
| Header tab | 16 / 24 / 500 | orange active, secondary idle |
| Card title | 18 / 27 / 500 | primary |
| Card subtitle (beside the title) | 16 / 24 / 500 | secondary |
| Section title on the page | 24 / 24 / 500 | primary |
| Body, sidebar item, table cell | 16 / 24 / 400 | primary |
| Emphasised cell (merchant name in Recurring) | 16 / 24 / 500 | primary |
| Small body (planned, spent, remaining) | 14 / 21 / 400-500 | secondary or primary |
| Button label | 14 / 21 / 500 | per variant |
| Table column head, date-group row | 14 / 21-24 / 500 | secondary |
| Form label | 14 / 20 / 500 | primary |
| Help text | 14 / 21 / 400 | secondary |
| Stat-tile caption | 12 / 18 / 600 | secondary |
| Overline (drawer field group) | 12 / 18 / 600 uppercase | secondary |
| Chip text | 12 / 18 / 500 | per chip |

Numbers are set in the same proportional sans, never monospace.
The marketing-style Forecasting hero is the one place a serif appears.

## 4. Layout

```
+----------+---------------------------------------------------+
| 224px    | top bar, 64px, page colour, padding 0 16px 0 24px |
| sidebar  +---------------------------------------------------+
| page     | content, padding 0 16px 16px, scrolls on its own  |
| colour   |  12-column grid, 16px gutters, 16px between cards |
+----------+---------------------------------------------------+
```

- The sidebar and the content column are siblings in a flex row. Only the content column scrolls.
- The top bar is part of the content column and does not scroll. Its title starts at x = 248, 8px to the right of the cards (x = 240).
- Dashboard: two equal columns (6 + 6 of 12), each a vertical stack of cards 16px apart.
- Accounts: a full-width chart card, then an 8 + 4 split (list, summary).
- Transactions, Budget, Goals: main card plus a fixed 320px summary card on the right.
- Cash Flow, Reports: a row of four equal stat tiles, then full-width cards.

## 5. Sidebar

- Width 224px, page colour, no border, no shadow.
- **Top row, 64px:** the mark (28px, at x = 18), then four 36px circular ghost buttons flush right: search, notifications, settings, collapse. Icons are 16px in the secondary colour, with no fill or border at rest.
- **Nav list:** starts at y = 64 with 12px left padding and none on the right, so the selected item's fill runs to the sidebar's right edge.
- **Nav item:** 36px tall, padding 8px 12px, radius 8px, 2px gap below. 16px icon, 12px gap, label 16 / 24 / 400 in `#eeeeec`.
- **Selected item:** fill `#2a2a28`, same text colour, and the icon switches to its filled variant. No orange, no side bar.
- **No section headings.** The ten destinations are one flat list.
- **Bottom block:** padding 0 0 12px 12px, no rule above it. Three link rows (AI Assistant in the gradient at weight 500; Help & Support and the referral link in the secondary colour), then the account row: 24px round avatar, name 16 / 24 / 400 secondary, 16px chevron at the far right.

## 6. Top bar

- 64px, page colour, padding 0 16px 0 24px, items centred vertically, 16px gap.
- Left: the page title. Pages with sub-views put text tabs right after it: 20px apart, 32px tall, 16 / 500, the active one orange with a 2px orange underline drawn inside the tab's own box. There is no full-width rule under the tabs.
- Right: 36px action buttons, 8px apart. Secondary actions first, a 1px vertical divider where groups change, and the single primary action last.
- The Dashboard's title is a greeting in the same 18 / 500 style, with one "Customize" button on the right.

## 7. Cards

- Fill `#222221`, radius 12px, shadow `0 2px 4px rgba(0,0,0,0.2)`, no border.
- **Header:** padding 12px 12px 12px 20px, so it is 60px tall with a 36px control in it, closed by a `#2a2a28` hairline. Title 18 / 500, then an optional subtitle in secondary 16 / 500 with an 8px gap, then the card's control flush right.
- A card title that links somewhere shows a small chevron to its left on hover.
- **Body rows:** padding 16px 20px, separated by the same hairline; the last row has none.
- **Stat tile:** a card with 24px padding, the value centred at about 20px / 500 (coloured when it is income or expense), and a 12 / 18 / 600 secondary caption 8px below.
- **Summary card (right rail):** header 12px 20px, then a definition list with rows 24px tall and 16px apart: label 14 / 400 secondary on the left, value 16 / 400 on the right. A centred "Download CSV" text link closes it.
- **Empty state:** centred in the card, a 500-weight headline and a regular line under it, no illustration.

## 8. Controls

### 8.1 Buttons

All are 36px tall, radius 8px, label 14 / 21 / 500, 8px between icon and label, 16px icons.

| Variant | Fill | Border | Text | Shadow |
| --- | --- | --- | --- | --- |
| Primary | `#ff692d` | none | `#ffffff` | `0 1px 2px rgba(0,0,0,0.1)` |
| Secondary | `#222221` | 1px `#3b3a37` | `#ffffff` | same |
| Text | none | none | `#23afd0` | none |
| Icon | none | none | `#989691` | none; 36px circle, or 24px inside a card header |

A full-width form submit is 40px tall with 8px 16px padding and a 16px label.
Joined pairs (List / Calendar) share one outline: outer corners 8px, inner corners square, the selected half filled `#2a2a28` with the stronger `#494846` border.

### 8.2 Select trigger

36px tall, radius 8px, fill `#222221`, border 1px `#494846`, padding 0 12px, value in 16 / 400, a 16px chevron in the secondary colour at the right.
On the dashboard each card's select is about 120 to 200px wide and sits in the card header.

### 8.3 Segmented pills

No track.
Each option is a 36px pill, radius 500px, padding 8px 16px, 14 / 20 / 500, 4px apart.
The selected one is filled (`#3b3a37` on the page colour, `#2a2a28` inside a card) with `#eeeeec` text; the rest are bare secondary text.

### 8.4 Inputs

About 40 to 48px tall, radius 8px, a 1px border in the control-border colour, and a fill that matches the card they sit on.
The label is above, 14 / 20 / 500, 4px gap; help text is below in secondary 14px.
Fields stack 16px apart.

### 8.5 Chips and badges

- Count or "New" badge: fill orange, white 12 / 18 / 500, radius 8px, padding 0 8px, 18px tall.
- Neutral status ("Pending"): fill `#2a2a28`, secondary text, radius 500px, padding 8px 12px.
- Budget "remaining" cell: a small rounded chip, tinted green or red, with matching text.
- Risk chip: amber tint with dark amber text, about 4px radius (observed).

### 8.6 Progress bars

8px tall, radius 8px, track `#3b3a37`, fill green `#30a46c` or red `#e5484d` when over.
A 2px by 16px white tick with a 1px card-coloured halo marks "today" across the bar.
The label row sits above (name left, "planned" right) and the result row below (spent left, remaining right, with only the number coloured).

## 9. Tables and lists

- **Transactions:** rows 50px tall with a hairline between them. Columns: 16px merchant logo and name; category with an emoji; account with a 16px institution logo; amount right-aligned, then a chevron. Each cell is itself a ghost button (radius 8px, 8px padding) that shows a border on hover, so a cell can be edited in place.
- **Date-group row:** 36px, fill `#2a2a28`, padding 0 16px, date on the left and the day's total on the right, both 14 / 500 secondary.
- **Table toolbar:** inside the card, above the rows: a select on the left; "Edit multiple", "Sort", and "Columns" as secondary buttons on the right.
- **Recurring:** a header row with a collapsible group title (18 / 500) and 14 / 500 secondary column heads; rows about 73px with a 40px round logo, a two-line name cell (name 16 / 500, cadence 16 / 400 secondary), and an overflow menu at the right. Overdue dates turn amber.
- **Budget:** group header rows with a collapse chevron and bold-looking totals; category rows 36px with an inline progress bar, a bordered editable "planned" input, a plain "actual", and a tinted "remaining" chip.
- **Accounts:** group header with name, change, and total; rows with a 32px round institution logo, name over type, a thin utilisation bar, a sparkline, and the balance over "last updated".

## 10. Charts

- Plotted directly on the card, no inner frame. Horizontal gridlines only, in a barely visible grey; axis labels 12px secondary.
- Line charts: a 2 to 3px stroke with a soft gradient fill fading to transparent. Net worth is cyan-blue, credit score teal, spending this-month orange against a grey last-month line.
- Cash flow: paired bars (green above the axis, red below) at low opacity for past months and full strength for the current one, with a white net line over them.
- The legend is small coloured text under the chart.

FundFlow's chart colours are **not** changed to match.
They come from the validated `--viz-*` slots (`docs/PALETTE.md`), and those rules stand.

## 11. Overlays

- **Detail drawer:** slides in from the right, about 460px wide, page-coloured, over a 50% black scrim. A toolbar row of pill buttons at the top and a close icon at the far right, then the entity header (48px logo left, amount and account right), then stacked label-over-field groups.
- **Popover menus:** card fill, 8 to 12px radius, soft shadow, rows about 36px.
- **Floating row navigator:** two 36px circular up / down buttons at the bottom right of the list while a drawer is open.

## 12. Motion

Short and quiet (observed): about 150ms colour transitions on hover, a slide for the drawer, no bounce or scale on press.

## 13. How FundFlow maps to this

Implemented on branch `ui/monarch-look-and-feel`:

| Area | Change | File |
| --- | --- | --- |
| Page background | Flat page colour; the accent glow is removed | `app/globals.css` |
| Type roles | `.page-title` 18 / 500, `.card-title` 18 / 500, `.eyebrow` 12 / 600, numerals at 500 | `app/globals.css` |
| Tokens | Field radius 8px, card shadow `0 2px 4px`, dark secondary text `#9b9994` | `app/globals.css` |
| Layout | Content is edge to edge with 16px gutters and 16px between cards | `components/shell/AppShell.tsx` |
| Top bar | `PageHeader` is a pinned 64px bar with the title inset 8px | `components/shell/PageHeader.tsx` |
| Sidebar | 224px, page-coloured, borderless; one 64px row for mark, utilities, and collapse; flat list; neutral selected state; 36px items at 16 / 400 | `components/shell/SidebarShell.tsx`, `AppSidebar.tsx` |
| Utility icons | 36px ghost circles with 16px icons | `SidebarUtilityIcons.tsx`, `SearchButton.tsx`, `NotificationsBell.tsx` |
| Account row, AI link | 24px avatar, 16 / 400 name; accent-coloured AI link at 500 | `UserMenu.tsx`, `AskAiLowerRailLink.tsx` |
| Cards | No border; titled cards get the full-bleed header with a hairline | `components/ui/Panel.tsx` |
| Buttons | 8px radius, weight 500, flat orange primary, 36px with a mouse | `components/ui/Button.tsx`, `DropdownButton.tsx` |
| Tabs | Text tabs 20px apart, orange active, no full-width rule | `components/ui/Tabs.tsx` |
| Segmented control | Trackless pills, filled when selected | `components/ui/SegmentedControl.tsx` |
| Inputs | Card-coloured fill, 8px radius | `components/ui/Input.tsx` |

### Deliberate differences

| Reference | FundFlow | Why |
| --- | --- | --- |
| Oracle typeface | Geist | Oracle is a licensed commercial font. Geist is the closest face already in the project. |
| Monarch's logo and icon font | FundFlow mark, lucide icons | Their brand assets are not ours to use. |
| White text on the orange button | Dark text on orange | White on `#ff692d` is about 2.9:1, below the 4.5:1 that `tests/unit/themes.test.ts` enforces. |
| Secondary text `#989691` | `#9b9994` | `#989691` measures 4.40:1 on the Arctic palette's raised surface; `#9b9994` clears 4.5:1 on all ten dark palettes. |
| 36px controls everywhere | 36px with a mouse, 44px on touch | The 44px touch target is an existing FundFlow rule; `pointer-fine:` applies the denser size only where a pointer is precise. |
| AI link in a red-to-orange gradient | Solid accent token | The gradient's red end fails contrast in light mode. |
| Ten flat destinations | Sixteen, with two 12px gaps | FundFlow has more destinations. Group names remain for screen readers. |
| Notifications and Settings only in the icon row | Also in the nav list | The icon row hides when the sidebar is collapsed, and nothing may become unreachable. |
| Chart hues | `--viz-*` slots | The CVD and contrast validator governs chart colour. |

### Not yet matched

These are page-level and were not changed in the first pass:

- **Weights inside pages.** Many components still set `font-semibold` or `font-bold` directly. The reference uses 400 and 500 only.
- **Hand-rolled pills.** Month chips, account chips, and several buttons outside the shared primitives are still fully rounded.
- **Body size.** Most FundFlow tables and lists are 14px; the reference is 16px.
- **Dashboard structure.** FundFlow's toolbar, month chips, view tabs, and status strip have no Monarch counterpart. The reference is a plain two-column stack of cards under the greeting.
- **Transactions table.** Date-group rows, in-cell editing affordances, and the 320px summary rail.
- **Outflows shown without red.** FundFlow colours expenses; the reference colours only inflows.
- **Budget, Recurring, Accounts rows.** Inline progress bars with a "today" tick, tinted remaining chips, sparklines.
- **Detail drawer** proportions and its pill toolbar.
- **Light mode** has not been compared against the reference at all.
