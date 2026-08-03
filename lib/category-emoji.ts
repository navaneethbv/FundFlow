/**
 * Static display-label -> emoji map for Sankey source/group/category nodes.
 *
 * Matched case-insensitively against a node's rendered label (the Sankey only
 * ever sees the display string, not the raw Plaid PFC key), so this mirrors
 * `groupDisplay`/`categoryDisplay` in `lib/reports.ts` rather than the raw
 * `RENT_AND_UTILITIES`-style enum. An unmatched label renders with no emoji
 * rather than a generic placeholder — a wrong glyph reads worse than none.
 *
 * The hub ("Income"/"Available Funds") and the two outcome nodes (Net Income,
 * Unfunded Spending) deliberately never look themselves up here; the chart
 * excludes them by id before calling this.
 */
const EMOJI_BY_LABEL: Readonly<Record<string, string>> = {
  // Income sources
  paychecks: "💵",
  salary: "💵",
  wages: "💵",
  "other income": "💰",
  interest: "🏦",

  // Shopping
  shopping: "🛍️",
  clothing: "👕",
  "furniture & housewares": "🛋️",
  electronics: "💻",

  // Financial
  financial: "🏦",
  "financial fees": "🏦",
  taxes: "🧾",
  "financial & legal services": "⚖️",
  "cash & atm": "🏧",
  insurance: "☂️",

  // Travel & Lifestyle
  "travel & lifestyle": "🌴",
  "travel & vacation": "🌴",
  "entertainment & recreation": "🎬",
  personal: "🧴",

  // Food & Dining
  "food & dining": "🍽️",
  "restaurants & bars": "🍽️",
  groceries: "🛒",
  "coffee shops": "☕",

  // Housing
  housing: "🏠",
  rent: "🏠",
  mortgage: "🏠",
  "home improvement": "🔨",

  // Health & Wellness
  "health & wellness": "🩺",
  dentist: "🦷",
  medical: "🩺",

  // Auto & Transport
  "auto & transport": "🚗",
  gas: "⛽",
  "auto maintenance": "🔧",
  "parking & tolls": "🅿️",
  "taxi & ride shares": "🚕",
  "public transit": "🚌",

  // Bills & Utilities
  "bills & utilities": "💡",
  "gas & electric": "⚡",
  phone: "📱",
  "internet & cable": "🌐",

  // Children / Business / Gifts / Education / catch-all
  children: "🧒",
  "child care": "🧒",
  "child activities": "🧸",
  business: "💼",
  "office supplies & expenses": "🖇️",
  "postage & shipping": "📦",
  "business utilities & communications": "☎️",
  "gifts & donations": "🎁",
  charity: "🙏",
  gifts: "🎁",
  education: "🎓",
  other: "💠",
  miscellaneous: "💲",
  unknown: "❓",
};

export function emojiForLabel(label: string): string {
  return EMOJI_BY_LABEL[label.trim().toLowerCase()] ?? "";
}
