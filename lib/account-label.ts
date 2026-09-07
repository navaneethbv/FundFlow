import { normalizeExternalDisplayText } from "@/lib/external-display-text";

function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

/** Display text only; never use this normalization for matching or identity. */
export function accountDisplayLabel(name: string | null | undefined, mask?: string | null): string {
  const clean = normalizeExternalDisplayText(name) ?? "";
  const unwrapped = clean.endsWith(")") ? clean.slice(0, -1).trimEnd() : clean;
  let base = clean;
  if (mask && unwrapped.endsWith(mask)) {
    const stripped = stripTrailingAccountMask(unwrapped, ".*•xX (", mask.length);
    // Plaid does not guarantee a four-digit mask. If the strip did not
    // actually consume the mask (a 2, 3, or 5+ digit mask that the old
    // fixed-four-digit check let through unchanged), fall back to `clean`
    // rather than appending the mask a second time.
    base = stripped !== unwrapped ? stripped : clean;
  }
  const display = base || "Account";
  const maskSuffix = mask ? ` ••${mask}` : "";
  return `${display}${maskSuffix}`;
}

function isLetter(value: string): boolean {
  const lower = value.toLowerCase();
  return lower >= "a" && lower <= "z";
}

function isWhitespace(value: string): boolean {
  return value.trim() === "";
}

function hasDigits(value: string, count: number): boolean {
  if (value.length !== count) return false;
  for (const character of value) {
    if (!isDigit(character)) return false;
  }
  return true;
}

/**
 * Strips a trailing card mask ("Amex Platinum ••••1234" -> "Amex Platinum",
 * "Chase Checking *1234" -> "Chase Checking").
 *
 * The mask characters must stay bound to the four digits, and `x` is only a
 * mask character where it is not part of the word before it: eating it
 * unconditionally turns "Amex 1234" into "Ame" and "Chase Freedom Flex 1234"
 * into "Chase Freedom Fle".
 *
 * Returns "" for a name that is nothing but a mask, so each caller picks its
 * own fallback.
 */
export function stripTrailingAccountMask(value: string, maskCharacters: string, maskLength = 4): string {
  const trimmed = value.trim();
  const digitsStart = trimmed.length - maskLength;
  if (
    digitsStart < 0 ||
    !hasDigits(trimmed.slice(digitsStart), maskLength)
  ) {
    return trimmed;
  }

  let start = digitsStart;
  while (start > 0 && isWhitespace(trimmed[start - 1]!)) start -= 1;
  while (start > 0 && maskCharacters.includes(trimmed[start - 1]!)) start -= 1;
  // Give back any letters the mask run borrowed from the end of a word.
  while (start < digitsStart && start > 0 && isLetter(trimmed[start]!) && !isWhitespace(trimmed[start - 1]!)) {
    start += 1;
  }
  return trimmed.slice(0, start).trimEnd();
}
