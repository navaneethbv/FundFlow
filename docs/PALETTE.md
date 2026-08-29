# Categorical chart palette

Why the `--viz-*` tokens in `app/globals.css` look the way they do, and why the
constraints on them are not negotiable by argument.
`scripts/validate_palette.js` is the enforcement point; this file is the record
of what it learned, so nobody has to rediscover it.

The short version lives in `CLAUDE.md`.
Read this before proposing any change to the palette.

## Seven slots is a measured ceiling, not a style preference

An 8th hue drops CVD separation to ΔE 2.4.
A 12-hue set drops it to 0.4, meaning identical colors to a deuteranope, plus
6.7 under normal vision.
The floors are 6 and 15.

Re-run the validator before proposing an eighth slot, and do not reason about it
in the abstract.
Fold the tail into "Other" via `foldTail` instead.

## The validator enforces two independent gates

Both must stay green:

1. **Pairwise separation**: normal ΔE ≥ 15, protan/deutan ΔE ≥ 6.
2. **WCAG 1.4.11 non-text contrast**: ≥ 3:1 for every slot against its own
   theme's `--panel`.

The second gate was added 2026-08-09, after a dark re-step passed the first and
still put three of seven slots under 3:1.
Pairwise ΔE says nothing about whether a series is visible on the surface it is
drawn on, so a set can separate perfectly from itself and still disappear.

## Re-step with the validator, never by eye

The dark set was re-stepped wholesale on 2026-08-09.
It now clears both gates on all seven slots, with a worst surface contrast of
3.62:1, at the light set's own OKLCH hues.
Keeping the hues shared is what makes the two modes read as one identity rather
than dark mode becoming a different-looking chart.

Changing one slot cannot fix a pair problem.
A 14,077-candidate sweep of a single slot found nothing that passes.

## Two standing caveats, both needing the same relief

The palette sits in the 6-8 CVD band, which is legal **only** with secondary
encoding.

Light `--viz-2` (2.82:1) and `--viz-3` (2.17:1) are below the contrast floor on
white.
They are carried as named exceptions in the validator, because a saturated aqua
and a yellow cannot reach 3:1 on `#ffffff` without abandoning the V0 identity.

So every chart must keep direct labels or a table twin.
That is what makes both caveats legal, and neither is dismissable without it.

**The exception list is a ratchet.**
Never extend it to make a re-step pass.

## Not part of this set

`--viz-pos` and `--viz-neg` are the diverging pair.
They do a different job on their own charts and are deliberately excluded from
the categorical set.

## Semantic text and control pairs

`scripts/validate_palette.js` also enforces WCAG 1.4.3 normal-text contrast
(≥ 4.5:1) for the app's shared semantic token pairs, so a token re-step that
reintroduces a failing text combination fails the build the same way a bad
`--viz-*` slot does.

The 2026-08-28 accessibility sweep found the pre-change tokens under the floor
in both themes: white text on the vivid orange `#ff6b2e` (2.83:1), light text
on the dark-mode accent `#ff8a54` (2.06:1), and the light `--muted` gray on
the pill surface (4.35:1). The tokens were corrected at the shared layer
rather than per component:

| Pair (light) | Before | After |
|---|---|---|
| `--accent` on `--panel` | 2.83:1 | 6.85:1 (`#9a3412`) |
| `--accent` on `--accent-soft` | 2.70:1 | 5.82:1 |
| `--accent-foreground` on `--accent-strong` | 2.83:1 | 6.37:1 (dark text on the vivid button) |
| `--muted` on `--pill` | 4.35:1 | 5.18:1 |
| `--success-foreground` on `--success` | 2.40:1 | 5.30:1 |
| `--danger-foreground` on `--danger` | 3.99:1 | 5.28:1 |
| `--viz-muted` on `--panel` | 3.57:1 | 5.15:1 |

| Pair (dark) | After |
|---|---|
| `--accent` on `--panel` | 7.25:1 (`#ff8a54`) |
| `--accent-foreground` on `--accent-strong` | 5.82:1 (dark text on `#ff6b2e`) |
| `--muted` on `--panel` | 5.69:1 |
| `--success-foreground` on `--success` | 7.11:1 |
| `--danger-foreground` on `--danger` | 5.95:1 |
| `--viz-muted` on `--panel` | 5.55:1 |

The brand stays orange in both themes: the light accent deepened to a burnt
orange (`#9a3412`) so it passes as text and as a fill, while the vivid
`#ff6b2e` remains the button fill in both themes with a dark foreground
(`--accent-foreground`) instead of white. Run `npm run validate:palette` after
any token change; it now gates every pair above.
