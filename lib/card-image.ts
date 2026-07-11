// Maps a card account to full-bleed artwork in /public/cards, matched by name.
// Kept separate from card-design.ts (color tokens) because the artwork set is
// richer than the gradient keyword set and the two match on different rules.
// Ordered most-specific first; the first rule whose keywords all appear wins.
const CARD_IMAGES: { keywords: string[]; file: string }[] = [
  { keywords: ["blue cash"], file: "amex-blue-cash-preferred.avif" },
  { keywords: ["amex", "preferred"], file: "amex-blue-cash-preferred.avif" },
  { keywords: ["gold"], file: "amex-gold.avif" },
  { keywords: ["platinum"], file: "amex-platinum.avif" },
  { keywords: ["amazon"], file: "chase-amazon-prime.avif" },
  { keywords: ["freedom", "unlimited"], file: "chase-freedom-unlimited.webp" },
  { keywords: ["freedom"], file: "chase-freedom.webp" },
  { keywords: ["reserve"], file: "chase-sapphire-reserve.avif" },
  { keywords: ["discover"], file: "discover.png" },
  { keywords: ["wells fargo"], file: "wells-fargo-signature.png" },
];

// Plaid returns a generic "CREDIT CARD" name for some issuers, so keyword
// matching can't tell them apart. Pin those by mask (last 4). Checked first.
const MASK_IMAGES: Record<string, string> = {
  "9181": "chase-freedom-unlimited.webp",
  "0366": "chase-sapphire-reserve.avif",
};

/**
 * Best-matching card artwork path for a card, or null when we have none.
 * "goldman" is excluded so it never trips the "gold" rule (mirrors card-design).
 */
export function detectCardImage(
  name: string | null | undefined,
  officialName: string | null | undefined,
  mask: string | null | undefined,
): string | null {
  if (mask && MASK_IMAGES[mask]) return `/cards/${MASK_IMAGES[mask]}`;

  const normName = `${name ?? ""} ${officialName ?? ""}`.toLowerCase();
  if (normName.includes("goldman")) return null;

  for (const { keywords, file } of CARD_IMAGES) {
    if (keywords.every((kw) => normName.includes(kw))) return `/cards/${file}`;
  }
  return null;
}
