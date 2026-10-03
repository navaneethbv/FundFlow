export interface SubscriptionCatalogEntry {
  id: string;
  name: string;
  typicalAmount: number;
  frequency: "monthly" | "yearly";
}

/** FundFlow-authored starting points. Amounts are prompts, never provider rates. */
export const SUBSCRIPTION_CATALOG: readonly SubscriptionCatalogEntry[] = [
  { id: "streaming", name: "Streaming service", typicalAmount: 15, frequency: "monthly" },
  { id: "cloud-storage", name: "Cloud storage", typicalAmount: 3, frequency: "monthly" },
  { id: "music", name: "Music plan", typicalAmount: 12, frequency: "monthly" },
  { id: "news", name: "News subscription", typicalAmount: 10, frequency: "monthly" },
  { id: "fitness", name: "Fitness membership", typicalAmount: 35, frequency: "monthly" },
  { id: "software", name: "Software plan", typicalAmount: 100, frequency: "yearly" },
];
