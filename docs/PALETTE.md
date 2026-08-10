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
