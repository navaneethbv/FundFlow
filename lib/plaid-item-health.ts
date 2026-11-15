const USER_ACTION_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "ITEM_NOT_FOUND",
  "INVALID_ACCESS_TOKEN",
  "ACCESS_NOT_GRANTED",
  "USER_PERMISSION_REVOKED",
  "ITEM_LOCKED",
  "NO_ACCOUNTS",
  "TOKEN_ROTATION_LOST",
]);

export function requiresPlaidUserAction(code: string | null | undefined): boolean {
  return code != null && USER_ACTION_CODES.has(code);
}

export function isPlaidReconnectWarning(code: string | null | undefined): boolean {
  return code === "PENDING_EXPIRATION" || code === "PENDING_DISCONNECT";
}

export function brokenBankSubjectKey(itemId: string, today: string): string {
  return `broken_bank:${itemId}:${today}`;
}


export function bankIdFromBrokenBankSubject(subject: unknown): string | null {
  if (typeof subject !== "string") return null;
  return /^broken_bank:([^:]+):\d{4}-\d{2}-\d{2}$/.exec(subject)?.[1] ?? null;
}

export function brokenBankDetails(institutionName: string | null, code: string) {
  const bank = institutionName || "your bank";
  if (code === "ITEM_LOGIN_REQUIRED") {
    return {
      title: `Reconnect ${institutionName || "your bank"}`,
      body: `${bank} needs you to sign in again. Open FundFlow Settings → Institutions and select Reconnect to restore syncing.`,
    };
  }
  return {
    title: `Bank connection issue: ${institutionName || "Bank"}`,
    body: `Open FundFlow Settings → Institutions to review the connection to ${bank} (${code}).`,
  };
}
