/** Versioned, user-facing highlights. Bump the version when this list changes. */
export const RELEASE_HIGHLIGHTS_VERSION = "2026-10-03";

export interface ReleaseHighlight {
  title: string;
  description: string;
  href: string;
}

export const RELEASE_HIGHLIGHTS: readonly ReleaseHighlight[] = [
  {
    title: "Clearer planning assumptions",
    description: "Forecasting now separates earmarked cash and explains every projection input.",
    href: "/forecasting",
  },
  {
    title: "Owner context at a glance",
    description: "Household account and activity surfaces can show an accessible owner marker.",
    href: "/accounts",
  },
  {
    title: "Safer review actions",
    description: "Import, duplicate, refund, and transfer decisions retain their evidence trail.",
    href: "/transactions",
  },
];

export function hasSeenReleaseHighlights(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    && (raw as Record<string, unknown>).releaseHighlightsSeen === RELEASE_HIGHLIGHTS_VERSION;
}
