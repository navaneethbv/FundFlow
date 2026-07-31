/**
 * Phase 13: profile field validation. Every field is optional — a user may
 * clear a value by sending `null` explicitly, and an absent key leaves the
 * stored value untouched (matching the advice profile's own PATCH
 * semantics from Phase 11).
 */
export interface ProfileFieldsPatch {
  fullName?: string | null;
  displayName?: string | null;
  birthday?: string | null;
}

export type ProfilePatchResult = { ok: true; value: ProfileFieldsPatch } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A birthday more than 130 years ago or in the future is certainly a typo. */
const MIN_BIRTH_YEAR_OFFSET = 130;

function validateOptionalText(
  value: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: `${field} must be a string or null` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > maxLength) {
    return { ok: false, error: `${field} must be at most ${maxLength} characters` };
  }
  return { ok: true, value: trimmed };
}

export function validateProfilePatch(body: unknown, today: string): ProfilePatchResult {
  const b = (body ?? {}) as Record<string, unknown>;

  const fullName = validateOptionalText(b.fullName, "fullName", 120);
  if (!fullName.ok) return fullName;

  const displayName = validateOptionalText(b.displayName, "displayName", 80);
  if (!displayName.ok) return displayName;

  let birthday: string | null | undefined;
  if (b.birthday === undefined) {
    birthday = undefined;
  } else if (b.birthday === null) {
    birthday = null;
  } else if (typeof b.birthday !== "string" || !DATE_RE.test(b.birthday)) {
    return { ok: false, error: "birthday must be a YYYY-MM-DD date or null" };
  } else if (b.birthday > today) {
    return { ok: false, error: "birthday cannot be in the future" };
  } else if (Number(today.slice(0, 4)) - Number(b.birthday.slice(0, 4)) > MIN_BIRTH_YEAR_OFFSET) {
    return { ok: false, error: "birthday is out of range" };
  } else {
    birthday = b.birthday;
  }

  return { ok: true, value: { fullName: fullName.value, displayName: displayName.value, birthday } };
}
