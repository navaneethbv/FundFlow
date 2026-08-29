import { describe, expect, it } from "vitest";
import { buildImportReview } from "@/lib/planning";

describe("buildImportReview category conflicts", () => {
  const row = { date: "2026-08-01", amount: 500, merchant: "Jewelry Store", category: "Shopping", sourceAccount: "Checking" };

  it("flags a category conflict when an existing transaction classifies the row differently", () => {
    const review = buildImportReview(
      [row],
      new Set(),
      new Map([["2026-08-01|500.00|Jewelry Store", "TRANSFER_OUT"]]),
    );
    expect(review.rows[0].flags).toContain("category-conflict");
  });

  it("does not flag a conflict when the existing category matches Monarch", () => {
    const review = buildImportReview(
      [row],
      new Set(),
      new Map([["2026-08-01|500.00|Jewelry Store", "SHOPPING"]]),
    );
    expect(review.rows[0].flags).not.toContain("category-conflict");
  });

  it("flags possible-duplicate even when categories agree", () => {
    const review = buildImportReview(
      [row],
      new Set(["2026-08-01|500.00|Jewelry Store"]),
      new Map([["2026-08-01|500.00|Jewelry Store", "SHOPPING"]]),
    );
    expect(review.rows[0].flags).toContain("possible-duplicate");
    expect(review.rows[0].flags).not.toContain("category-conflict");
  });

  it("keeps the existing flag contract when no category map is supplied", () => {
    const review = buildImportReview([row], new Set(["2026-08-01|500.00|Jewelry Store"]));
    expect(review.rows[0].flags).toEqual(["possible-duplicate"]);
  });
});
