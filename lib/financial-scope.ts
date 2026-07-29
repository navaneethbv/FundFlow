/**
 * The scope every financial page runs under. Parsing is deliberately
 * conservative: a household id is only honored when it appears in the list the
 * RLS-bound households query returned, so a guessed or stale id degrades to the
 * caller's own rows instead of erroring or leaking.
 */
export type FinancialScope =
  | { kind: "mine"; ownerUserId: string }
  | { kind: "household"; householdId: string };

export const SCOPE_PARAM = "scope";

/** Pre-household URLs used `?scope=household`; still accepted. */
const HOUSEHOLD_KEYWORD = "household";

export interface ParseFinancialScopeInput {
  /** The raw `?scope=` value; Next.js may hand back a repeated param. */
  raw: string | string[] | undefined;
  ownerUserId: string;
  /** Household ids visible to this user through RLS. */
  visibleHouseholdIds: string[];
}

export function parseFinancialScope(input: ParseFinancialScopeInput): FinancialScope {
  const mine: FinancialScope = { kind: "mine", ownerUserId: input.ownerUserId };
  const first = Array.isArray(input.raw) ? input.raw[0] : input.raw;
  const value = first?.trim();
  if (!value || value === "mine") return mine;

  const householdId =
    value === HOUSEHOLD_KEYWORD
      ? input.visibleHouseholdIds[0]
      : input.visibleHouseholdIds.find((id) => id === value);

  return householdId ? { kind: "household", householdId } : mine;
}

/** The URL value for a scope, or undefined when the default needs no param. */
export function serializeFinancialScope(scope: FinancialScope): string | undefined {
  return scope.kind === "household" ? scope.householdId : undefined;
}

/**
 * The `user_id` a query should filter on. Household scope returns undefined so
 * RLS-visible shared rows blend in — which is only safe on the cookie-bound
 * client. Service-client callers must always be in `mine` scope.
 */
export function scopeQueryUserId(scope: FinancialScope): string | undefined {
  return scope.kind === "mine" ? scope.ownerUserId : undefined;
}

export function isHouseholdScope(scope: FinancialScope): boolean {
  return scope.kind === "household";
}
