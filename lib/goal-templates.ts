import type { GoalType } from "@/lib/goals-v2";

/**
 * The goal templates the wizard's first step offers.
 *
 * The illustrations in `public/goals/` are original flat-vector artwork authored
 * for FundFlow — deliberately not traced, cropped, or recoloured from any other
 * product's assets. They are SVG rather than the JPEGs the plan sketched: the
 * whole set is under 5KB, it stays crisp at any card size, and it needs no
 * external host, which matters because the CSP's `img-src` allows `'self'` only.
 */

export interface GoalTemplate {
  slug: string;
  label: string;
  /** Default copy pre-filled into the wizard, editable by the user. */
  description: string;
  goalType: GoalType;
  /** A starting figure, not a recommendation; every template is editable. */
  suggestedTarget: number | null;
  /** Describes the illustration for anyone who cannot see it. */
  alt: string;
}

export const GOAL_TEMPLATES: readonly GoalTemplate[] = [
  {
    slug: "emergency-fund",
    label: "Emergency fund",
    description: "A cushion for the month everything goes wrong at once.",
    goalType: "save_up",
    suggestedTarget: 10_000,
    alt: "A shield with a check mark inside it",
  },
  {
    slug: "down-payment",
    label: "Home down payment",
    description: "The deposit that turns rent into a mortgage.",
    goalType: "save_up",
    suggestedTarget: 60_000,
    alt: "A house with a bright window and a chimney",
  },
  {
    slug: "car",
    label: "Car",
    description: "Save for the next car instead of financing it.",
    goalType: "save_up",
    suggestedTarget: 25_000,
    alt: "A side view of a compact car",
  },
  {
    slug: "vacation",
    label: "Vacation",
    description: "A trip paid for before you leave, not after you're back.",
    goalType: "save_up",
    suggestedTarget: 4_000,
    alt: "A palm tree on a shoreline under the sun",
  },
  {
    slug: "wedding",
    label: "Wedding",
    description: "The day itself, budgeted on purpose.",
    goalType: "save_up",
    suggestedTarget: 20_000,
    alt: "Two interlocking wedding rings",
  },
  {
    slug: "education",
    label: "Education",
    description: "Tuition, a course, or a certification worth having.",
    goalType: "save_up",
    suggestedTarget: 15_000,
    alt: "A graduation cap with a tassel",
  },
  {
    slug: "retirement",
    label: "Retirement",
    description: "The long one. Small monthly amounts compound.",
    goalType: "save_up",
    suggestedTarget: 100_000,
    alt: "The sun rising over rolling hills",
  },
  {
    slug: "savings",
    label: "General savings",
    description: "No particular plan yet — just building the balance.",
    goalType: "save_up",
    suggestedTarget: 5_000,
    alt: "A stack of coins beside a larger coin",
  },
] as const;

const BY_SLUG = new Map(GOAL_TEMPLATES.map((template) => [template.slug, template]));

export function goalTemplateBySlug(slug: string | null): GoalTemplate | null {
  if (!slug) return null;
  return BY_SLUG.get(slug) ?? null;
}

/**
 * The image URL for a slug, or null if the slug is not one we ship.
 *
 * `image_slug` is a database string, so interpolating it straight into a path
 * would let a crafted value walk out of `public/goals/`. Only known slugs
 * resolve; anything else renders the card's fallback treatment instead.
 */
export function goalImageFor(slug: string | null): string | null {
  return BY_SLUG.has(slug ?? "") ? `/goals/${slug}.svg` : null;
}

export function goalImageAlt(slug: string | null): string {
  return goalTemplateBySlug(slug)?.alt ?? "";
}

/** True when the slug is safe to store. Used by the goal write paths. */
export function isKnownGoalImageSlug(slug: unknown): slug is string {
  return typeof slug === "string" && BY_SLUG.has(slug);
}
