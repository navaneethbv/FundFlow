/**
 * Merchant logos from a curated static dataset: the Simple Icons package
 * ships trademark-checked SVG paths offline, so no live scraper, no external
 * image host, and no CSP change are involved — the icon is rendered from a
 * data URI at the merchant's own brand color.
 *
 * An unmatched merchant renders with the deterministic initial disc
 * (components/ui/Avatar.tsx), exactly as before — a wrong logo reads worse
 * than none. Keys match the rules-applied display name shown in the ledger,
 * normalized case- and punctuation-insensitively.
 */

import {
  siAirbnb,
  siAdidas,
  siAmericanexpress,
  siApple,
  siBurgerking,
  siChase,
  siBookingdotcom,
  siDelta,
  siDiscover,
  siDoordash,
  siEbay,
  siEtsy,
  siExpedia,
  siFord,
  siGoogle,
  siHbomax,
  siHellofresh,
  siHilton,
  siIkea,
  siInstacart,
  siJetblue,
  siLyft,
  siMarriott,
  siMax,
  siMcdonalds,
  siNike,
  siNetflix,
  siPaypal,
  siPlaystation,
  siPostmates,
  siSamsclub,
  siSamsung,
  siShell,
  siShopify,
  siSouthwestairlines,
  siSpotify,
  siSteam,
  siStubhub,
  siStarbucks,
  siTacobell,
  siTarget,
  siTesla,
  siTicketmaster,
  siUber,
  siUnitedairlines,
  siVenmo,
  siVerizon,
  type SimpleIcon,
} from "simple-icons";

interface MerchantBrand {
  icon: SimpleIcon;
  /** Extra accepted spellings, compared in normalized form. */
  aliases?: string[];
}

const BRANDS: readonly MerchantBrand[] = [
  { icon: siNetflix, aliases: ["netflixcom"] },
  { icon: siSpotify },
  { icon: siStarbucks },
  { icon: siTarget, aliases: ["targetstore"] },
  { icon: siUber, aliases: ["uberride", "ubertrip"] },
  { icon: siLyft },
  { icon: siAirbnb },
  { icon: siDoordash, aliases: ["doordashcom"] },
  { icon: siApple, aliases: ["applestore", "applecom"] },
  { icon: siGoogle, aliases: ["googlellc", "googlesvcs"] },
  { icon: siVenmo },
  { icon: siPaypal },
  { icon: siAmericanexpress, aliases: ["amex", "americanexpresscard"] },
  { icon: siChase, aliases: ["chasecard", "chasebank"] },
  { icon: siDiscover, aliases: ["discovercard", "discoverbank"] },
  { icon: siVerizon, aliases: ["verizonwireless"] },
  { icon: siShell, aliases: ["shelloil", "shellgasstation"] },
  { icon: siDelta, aliases: ["deltaairlines"] },
  { icon: siUnitedairlines, aliases: ["unitedair", "ual"] },
  { icon: siSouthwestairlines, aliases: ["southwestair"] },
  { icon: siJetblue, aliases: ["jetblueairways"] },
  { icon: siMcdonalds, aliases: ["mcd", "mcdonalds"] },
  { icon: siBurgerking, aliases: ["bk"] },
  { icon: siTacobell },
  { icon: siHilton, aliases: ["hiltonhotels", "hiltonhhonors"] },
  { icon: siMarriott, aliases: ["marriotthotels", "marriottbonvoy"] },
  { icon: siBookingdotcom, aliases: ["bookingcom"] },
  { icon: siExpedia, aliases: ["expediacom"] },
  { icon: siIkea },
  { icon: siEtsy },
  { icon: siEbay },
  { icon: siInstacart },
  { icon: siHellofresh },
  { icon: siPostmates },
  { icon: siSteam, aliases: ["steampowered"] },
  { icon: siPlaystation, aliases: ["playstationstore", "sonyplaystation"] },
  { icon: siSamsung },
  { icon: siTesla },
  { icon: siFord },
  { icon: siAdidas },
  { icon: siNike },
  { icon: siShopify },
  { icon: siSamsclub, aliases: ["samsclubcom"] },
  { icon: siTicketmaster, aliases: ["ticketmastercom"] },
  { icon: siStubhub },
  { icon: siHbomax },
  { icon: siMax, aliases: ["maxcom", "hbomax"] },
].filter((brand) => Boolean(brand.icon?.path));

function normalizeMerchant(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const LOOKUP: ReadonlyMap<string, SimpleIcon> = (() => {
  const map = new Map<string, SimpleIcon>();
  for (const brand of BRANDS) {
    map.set(normalizeMerchant(brand.icon.title), brand.icon);
    for (const alias of brand.aliases ?? []) {
      if (!map.has(alias)) map.set(alias, brand.icon);
    }
  }
  return map;
})();

/** The Simple Icon for a merchant display name, or null when unmapped. */
export function merchantBrandIcon(name: string): SimpleIcon | null {
  const normalized = normalizeMerchant(name);
  if (!normalized) return null;
  return LOOKUP.get(normalized) ?? null;
}

/**
 * An `<img>`-ready data URI for the merchant's logo in its brand color, or
 * null when unmapped (the avatar falls back to the initial disc). Data URIs
 * are CSP-allowed and introduce no external host or request.
 */
export function merchantLogoDataUri(name: string, size = 24): string | null {
  const icon = merchantBrandIcon(name);
  if (!icon) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"><title>${icon.title}</title><path fill="#${icon.hex}" d="${icon.path}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
