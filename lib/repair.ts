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

export interface RepairResponse {
  ok: boolean;
  status: string;
  message?: string;
  pagesCompleted?: number;
  maxPages?: number;
  completed?: boolean;
  added?: number;
  modified?: number;
  removed?: number;
}

export interface RepairUiState {
  kind:
    | "success"
    | "backfill_incomplete"
    | "info"
    | "needs_consent"
    | "needs_login"
    | "rate_limited"
    | "error";
  message: string;
  /** Show a retry action. */
  retry: boolean;
  /** Show a reconnect (Link update) action. */
  reconnect: boolean;
  result?: { added: number; modified: number; removed: number };
}

/**
 * Turn a repair route response into the UI state a settings row must render.
 * Provider-conditional outcomes become reconnect or retry actions; success and
 * bounded backfill report concrete progress.
 */
export function repairResponseToUiState(
  response: RepairResponse | null,
): RepairUiState {
  if (!response || !response.ok) {
    const status = response?.status;
    if (status === "product_not_ready") {
      return {
        kind: "info",
        message: response?.message ?? repairMessage("product_not_ready"),
        retry: true,
        reconnect: false,
      };
    }
    if (status === "consent_required") {
      return {
        kind: "needs_consent",
        message: response?.message ?? repairMessage("consent_required"),
        retry: false,
        reconnect: true,
      };
    }
    if (status === "institution_login_required") {
      return {
        kind: "needs_login",
        message: response?.message ?? repairMessage("institution_login_required"),
        retry: false,
        reconnect: true,
      };
    }
    if (status === "rate_limited") {
      return {
        kind: "rate_limited",
        message: response?.message ?? repairMessage("rate_limited"),
        retry: true,
        reconnect: false,
      };
    }
    return {
      kind: "error",
      message:
        response?.message ?? "The repair could not be completed. Try again.",
      retry: true,
      reconnect: false,
    };
  }

  const result = {
    added: response.added ?? 0,
    modified: response.modified ?? 0,
    removed: response.removed ?? 0,
  };
  if (response.status === "backfill_incomplete") {
    return {
      kind: "backfill_incomplete",
      message: `History backfill reached ${response.pagesCompleted ?? 0} of ${response.maxPages ?? 0} pages. Run again to continue; retries never duplicate transactions.`,
      retry: true,
      reconnect: false,
      result,
    };
  }
  return {
    kind: "success",
    message: `Repaired. ${result.added} added, ${result.modified} modified, ${result.removed} removed.`,
    retry: false,
    reconnect: false,
    result,
  };
}

/**
 * Run the authenticated repair for one owned item and return the UI state.
 * Network failures collapse to a retryable error state.
 */
export async function runItemRepair(itemId: string): Promise<RepairUiState> {
  try {
    const res = await fetch("/api/plaid/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    const json = (await res.json().catch(() => null)) as RepairResponse | null;
    return repairResponseToUiState(json);
  } catch {
    return repairResponseToUiState(null);
  }
}