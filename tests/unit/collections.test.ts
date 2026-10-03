import { describe, expect, it } from "vitest";
import { buildCollections, collectionNameFromTag, COLLECTION_TAG_PREFIX } from "@/lib/collections";

const annotations = [
  { transaction_id: "t1", tags: ["collection:Japan trip", "travel"] },
  { transaction_id: "t2", tags: ["collection:Japan trip"] },
  { transaction_id: "t3", tags: ["collection:Japan trip"] },
  { transaction_id: "t4", tags: ["collection:Kitchen"] },
  { transaction_id: "t5", tags: ["work"] },
  { transaction_id: "missing", tags: ["collection:Kitchen"] },
];
const transactions = [
  { id: "t1", date: "2026-04-02", amount: 1200, pfc_primary: "TRAVEL" },
  { id: "t2", date: "2026-04-05", amount: -150, pfc_primary: "TRAVEL" },
  // A card payment tagged into the trip is a transfer, never spend.
  { id: "t3", date: "2026-04-09", amount: 900, pfc_primary: "LOAN_PAYMENTS" },
  { id: "t4", date: "2026-05-01", amount: 300.5, pfc_primary: "HOME_IMPROVEMENT" },
];

describe("collections", () => {
  it("reads collection names from prefixed tags only", () => {
    expect(collectionNameFromTag("collection:Japan trip")).toBe("Japan trip");
    expect(collectionNameFromTag("collection:  ")).toBeNull();
    expect(collectionNameFromTag("travel")).toBeNull();
    expect(COLLECTION_TAG_PREFIX).toBe("collection:");
  });

  it("totals net spend per collection, excluding transfers and netting refunds", () => {
    const result = buildCollections(annotations, transactions, [{ name: "Japan trip", budget: 1000 }]);
    // Most recently active first.
    expect(result).toEqual([
      { name: "Kitchen", spent: 300.5, count: 1, firstDate: "2026-05-01", lastDate: "2026-05-01", budget: null, remaining: null },
      { name: "Japan trip", spent: 1050, count: 3, firstDate: "2026-04-02", lastDate: "2026-04-09", budget: 1000, remaining: -50 },
    ]);
  });

  it("matches budgets case-insensitively and ignores budgets without transactions", () => {
    const result = buildCollections(annotations, transactions, [{ name: "kitchen", budget: 500 }, { name: "Unused", budget: 10 }]);
    expect(result.find((row) => row.name === "Kitchen")).toMatchObject({ budget: 500, remaining: 199.5 });
    expect(result.some((row) => row.name === "Unused")).toBe(false);
  });

  it("returns nothing when no transaction carries a collection tag", () => {
    expect(buildCollections([{ transaction_id: "t5", tags: ["work"] }], transactions, [])).toEqual([]);
  });
});
