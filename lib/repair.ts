import "server-only";

/**
 * Authenticated repair classification. The repair route maps provider errors
 * to a small set of actionable states so Settings can explain what is needed
 * instead of showing a generic failure.
 */

export type RepairFailureKind =
  | "product_not_ready"
  | "consent_required"
  | "institution_login_required"
  | "rate_limited"
  | "generic_failure";

const CONSENT_CODES = new Set(["ADDITIONAL_CONSENT_REQUIRED"]);
const LOGIN_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "ITEM_ACCESS_NOT_GRANTED",
  "ITEM_PERMISSIONS_REQUIRED",
  "ITEM_VERIFICATION_MODE_ACTIVE",
  "ITEM_ERROR",
  "USER_PERMISSION_REVOKED",
]);
const RATE_LIMIT_CODES = new Set(["RATE_LIMIT", "RATE_LIMIT_EXCEEDED"]);

function plaidErrorCode(error: unknown): string | null {
  const code = (error as { response?: { data?: { error_code?: unknown } } })
    ?.response?.data?.error_code;
  return typeof code === "string" ? code : null;
}

/**
 * Classify a provider error into the state the UI must surface. Any known
 * item-level code that is not product/consent/rate-limit means the connection
 * itself needs a re-link; a missing code is a genuine unexpected failure.
 */
export function classifyRepairError(error: unknown): RepairFailureKind {
  const code = plaidErrorCode(error);
  if (code === "PRODUCT_NOT_READY") return "product_not_ready";
  if (code && CONSENT_CODES.has(code)) return "consent_required";
  if (code && LOGIN_CODES.has(code)) return "institution_login_required";
  if (code && RATE_LIMIT_CODES.has(code)) return "rate_limited";
  if (code) return "institution_login_required";
  return "generic_failure";
}

export const REPAIR_MAX_PAGES = 8;
export const REPAIR_MAX_ATTEMPTS = 3;
export const REPAIR_WINDOW_SECONDS = 60;

export function repairMessage(kind: RepairFailureKind): string {
  switch (kind) {
    case "product_not_ready":
      return "This product is not ready yet at your institution. Try again in a little while.";
    case "consent_required":
      return "Your bank needs new consent. Reconnect this institution to grant it.";
    case "institution_login_required":
      return "Your bank requires you to log in again. Reconnect this institution to restore access.";
    case "rate_limited":
      return "The provider asked FundFlow to retry later. Wait a moment and try again.";
    default:
      return "The repair could not be completed. Try again.";
  }
}