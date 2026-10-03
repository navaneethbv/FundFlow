import { describe, expect, it } from "vitest";
import { trainLocalBayes } from "@/lib/bayes-categorizer";

function rows(): Array<{ id: string; merchant: string; name: string; category: string | null }> {
  return [
    ...Array.from({ length: 12 }, (_, index) => ({ id: `food-${index}`, merchant: "Fresh Market", name: "grocery purchase", category: "Food" })),
    ...Array.from({ length: 12 }, (_, index) => ({ id: `travel-${index}`, merchant: "City Rail", name: "train ticket", category: "Travel" })),
    { id: "new", merchant: "Fresh Market", name: "grocery purchase", category: null },
  ];
}

describe("local Bayes categorizer", () => {
  it("requires enough labeled rows and categories", () => {
    expect(trainLocalBayes(rows().slice(0, 5))).toMatchObject({ eligible: false, reason: "not_enough_rows" });
    expect(trainLocalBayes(rows().map((row) => ({ ...row, category: "Food" }))).reason).toBe("not_enough_categories");
  });

  it("uses add-one smoothing and only suggests confident uncategorized rows", () => {
    const result = trainLocalBayes(rows());
    expect(result.eligible).toBe(true);
    expect(result.suggestions[0]).toMatchObject({ transactionId: "new", category: "Food", sampleSize: 24 });
    expect(result.suggestions[0]?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("skips empty descriptors and low-confidence suggestions", () => {
    const result = trainLocalBayes([
      ...rows(),
      { id: "blank", merchant: null, name: null, category: null },
      { id: "unknown", merchant: "Mystery", name: "", category: null },
    ]);
    expect(result.suggestions.map((suggestion) => suggestion.transactionId)).toEqual(["new"]);
  });
});
