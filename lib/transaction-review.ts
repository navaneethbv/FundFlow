export type TransactionReviewStatus = "needs_review" | "reviewed";

export interface TransactionReviewItem {
  transaction_id: string;
  expected_version: string;
}

export interface TransactionReviewBatchPayload {
  status: TransactionReviewStatus;
  items: TransactionReviewItem[];
}

export interface TransactionReviewResultItem {
  transaction_id: string;
  status: TransactionReviewStatus;
  version: string;
  reviewed_at: string | null;
}

export interface TransactionReviewResult {
  updated: number;
  unchanged: number;
  items: TransactionReviewResultItem[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION_RE = /^[1-9][0-9]*$/;

export const MAX_REVIEW_BATCH_SIZE = 100;
export const MAX_PAYLOAD_BYTES = 32 * 1024; // 32 KiB

export function isEligibleForReview(row: {
  pending?: boolean | null;
  excludedDuplicate?: boolean | null;
  review_eligible?: boolean | null;
  review_state_missing?: boolean | null;
}): boolean {
  if (row.review_state_missing) return false;
  if (row.review_eligible !== undefined && row.review_eligible !== null) {
    return Boolean(row.review_eligible);
  }
  return !row.pending && !row.excludedDuplicate;
}

type ItemResult =
  | { ok: true; item: TransactionReviewItem }
  | { ok: false; error: string };

function normalizeExpectedVersion(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value);
  }
  return "";
}

function validateReviewItem(raw: unknown): ItemResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Each item must be an object" };
  }
  const it = raw as Record<string, unknown>;

  const unexpectedKey = Object.keys(it).find(
    (key) => key !== "transaction_id" && key !== "expected_version",
  );
  if (unexpectedKey) {
    return { ok: false, error: `Unexpected field on item: ${unexpectedKey}` };
  }

  const txId =
    typeof it.transaction_id === "string" ? it.transaction_id.trim() : "";
  if (!UUID_RE.test(txId)) {
    return { ok: false, error: `Invalid transaction_id: "${txId}"` };
  }

  const expectedVersion = normalizeExpectedVersion(it.expected_version);
  if (!VERSION_RE.test(expectedVersion)) {
    return { ok: false, error: `Invalid expected_version for transaction ${txId}` };
  }

  return { ok: true, item: { transaction_id: txId, expected_version: expectedVersion } };
}

export type ReviewBatchValidationResult =
  | { valid: true; data: TransactionReviewBatchPayload }
  | { valid: false; error: string };

export function validateReviewBatchPayload(
  raw: unknown,
): ReviewBatchValidationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, error: "Payload must be a JSON object" };
  }

  const obj = raw as Record<string, unknown>;

  const unexpectedTopKey = Object.keys(obj).find(
    (key) => key !== "status" && key !== "items",
  );
  if (unexpectedTopKey) {
    return { valid: false, error: `Unexpected field: ${unexpectedTopKey}` };
  }

  if (obj.status !== "needs_review" && obj.status !== "reviewed") {
    return {
      valid: false,
      error: "Status must be either 'needs_review' or 'reviewed'",
    };
  }

  if (!Array.isArray(obj.items)) {
    return { valid: false, error: "Items must be an array" };
  }

  if (obj.items.length === 0) {
    return { valid: false, error: "Items array must not be empty" };
  }

  if (obj.items.length > MAX_REVIEW_BATCH_SIZE) {
    return {
      valid: false,
      error: `Batch cannot exceed ${MAX_REVIEW_BATCH_SIZE} items`,
    };
  }

  const seen = new Set<string>();
  const sanitizedItems: TransactionReviewItem[] = [];

  for (const entry of obj.items) {
    const result = validateReviewItem(entry);
    if (!result.ok) {
      return { valid: false, error: result.error };
    }
    if (seen.has(result.item.transaction_id)) {
      return {
        valid: false,
        error: `Duplicate transaction_id in batch: "${result.item.transaction_id}"`,
      };
    }
    seen.add(result.item.transaction_id);
    sanitizedItems.push(result.item);
  }

  return {
    valid: true,
    data: {
      status: obj.status as TransactionReviewStatus,
      items: sanitizedItems,
    },
  };
}
