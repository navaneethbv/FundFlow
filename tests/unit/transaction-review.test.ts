import { describe, expect, it } from "vitest";
import {
  isEligibleForReview,
  MAX_REVIEW_BATCH_SIZE,
  validateReviewBatchPayload,
} from "@/lib/transaction-review";

describe("lib/transaction-review", () => {
  describe("validateReviewBatchPayload", () => {
    const validUuid1 = "11111111-1111-4111-8111-111111111111";
    const validUuid2 = "22222222-2222-4222-8222-222222222222";

    it("accepts a valid single review payload", () => {
      const payload = {
        status: "reviewed",
        items: [{ transaction_id: validUuid1, expected_version: "1" }],
      };
      const result = validateReviewBatchPayload(payload);
      expect(result.valid).toBe(true);
      if (result.valid && result.data) {
        expect(result.data.status).toBe("reviewed");
        expect(result.data.items).toHaveLength(1);
        expect(result.data.items[0].transaction_id).toBe(validUuid1);
        expect(result.data.items[0].expected_version).toBe("1");
      }
    });

    it("accepts numeric expected_version and converts to string", () => {
      const payload = {
        status: "reviewed",
        items: [{ transaction_id: validUuid1, expected_version: 5 }],
      };
      const result = validateReviewBatchPayload(payload);
      expect(result.valid).toBe(true);
      if (result.valid && result.data) {
        expect(result.data.items[0].expected_version).toBe("5");
      }
    });

    it("accepts a valid bulk reopen payload", () => {
      const payload = {
        status: "needs_review",
        items: [
          { transaction_id: validUuid1, expected_version: "2" },
          { transaction_id: validUuid2, expected_version: "1" },
        ],
      };
      const result = validateReviewBatchPayload(payload);
      expect(result.valid).toBe(true);
      if (result.valid && result.data) {
        expect(result.data.status).toBe("needs_review");
        expect(result.data.items).toHaveLength(2);
      }
    });

    it("rejects non-object or null payloads", () => {
      expect(validateReviewBatchPayload(null).valid).toBe(false);
      expect(validateReviewBatchPayload("invalid").valid).toBe(false);
      expect(validateReviewBatchPayload([]).valid).toBe(false);
    });

    it("rejects invalid status values", () => {
      const payload = {
        status: "approved",
        items: [{ transaction_id: validUuid1, expected_version: "1" }],
      };
      const result = validateReviewBatchPayload(payload);
      expect(result.valid).toBe(false);
    });

    it("rejects non-array or empty items list", () => {
      expect(validateReviewBatchPayload({ status: "reviewed", items: null }).valid).toBe(false);
      expect(validateReviewBatchPayload({ status: "reviewed", items: [] }).valid).toBe(false);
    });

    it("rejects unexpected top-level fields", () => {
      const payload = {
        status: "reviewed",
        items: [{ transaction_id: validUuid1, expected_version: "1" }],
        user_id: "attacker-supplied",
      };
      const result = validateReviewBatchPayload(payload);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Unexpected field: user_id/);
    });

    it("rejects unexpected fields on an item", () => {
      const payload = {
        status: "reviewed",
        items: [
          { transaction_id: validUuid1, expected_version: "1", reviewed_at: "2026-01-01" },
        ],
      };
      const result = validateReviewBatchPayload(payload);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Unexpected field on item: reviewed_at/);
    });

    it("rejects non-integer, zero, and negative numeric expected_version", () => {
      for (const bad of [0, -3, 2.5, Number.NaN]) {
        const result = validateReviewBatchPayload({
          status: "reviewed",
          items: [{ transaction_id: validUuid1, expected_version: bad }],
        });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/Invalid expected_version/);
      }
    });

    it("rejects a non-object item", () => {
      const result = validateReviewBatchPayload({
        status: "reviewed",
        items: ["not-an-object"],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Each item must be an object/);
    });

    it("rejects invalid transaction_id format", () => {
      const payload = {
        status: "reviewed",
        items: [{ transaction_id: "not-a-uuid", expected_version: "1" }],
      };
      const result = validateReviewBatchPayload(payload);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Invalid transaction_id/);
    });

    it("rejects invalid expected_version values", () => {
      const payloadNegative = {
        status: "reviewed",
        items: [{ transaction_id: validUuid1, expected_version: "-1" }],
      };
      expect(validateReviewBatchPayload(payloadNegative).valid).toBe(false);

      const payloadZero = {
        status: "reviewed",
        items: [{ transaction_id: validUuid1, expected_version: "0" }],
      };
      expect(validateReviewBatchPayload(payloadZero).valid).toBe(false);

      const payloadAlpha = {
        status: "reviewed",
        items: [{ transaction_id: validUuid1, expected_version: "abc" }],
      };
      expect(validateReviewBatchPayload(payloadAlpha).valid).toBe(false);
    });

    it("rejects duplicate transaction_ids within the same batch", () => {
      const payload = {
        status: "reviewed",
        items: [
          { transaction_id: validUuid1, expected_version: "1" },
          { transaction_id: validUuid1, expected_version: "1" },
        ],
      };
      const result = validateReviewBatchPayload(payload);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Duplicate transaction_id/);
    });

    it("rejects batch sizes larger than MAX_REVIEW_BATCH_SIZE", () => {
      const items = Array.from({ length: MAX_REVIEW_BATCH_SIZE + 1 }, (_, i) => ({
        transaction_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        expected_version: "1",
      }));
      const payload = {
        status: "reviewed",
        items,
      };
      const result = validateReviewBatchPayload(payload);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Batch cannot exceed/);
    });
  });

  describe("isEligibleForReview", () => {
    it("returns false if review_state_missing is true", () => {
      expect(isEligibleForReview({ review_state_missing: true, pending: false })).toBe(false);
    });

    it("respects explicit review_eligible flag if provided", () => {
      expect(isEligibleForReview({ review_eligible: false, pending: false })).toBe(false);
      expect(isEligibleForReview({ review_eligible: true, pending: true })).toBe(true);
    });

    it("returns false for pending transactions", () => {
      expect(isEligibleForReview({ pending: true })).toBe(false);
    });

    it("returns false for excluded duplicates", () => {
      expect(isEligibleForReview({ pending: false, excludedDuplicate: true })).toBe(false);
    });

    it("returns true for normal posted transactions", () => {
      expect(isEligibleForReview({ pending: false, excludedDuplicate: false })).toBe(true);
      expect(isEligibleForReview({})).toBe(true);
    });
  });
});
