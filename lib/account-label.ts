function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function isLetter(value: string): boolean {
  const lower = value.toLowerCase();
  return lower >= "a" && lower <= "z";
}

function isWhitespace(value: string): boolean {
  return value.trim() === "";
}

function hasFourDigits(value: string): boolean {
  if (value.length !== 4) return false;
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
export function stripTrailingAccountMask(value: string, maskCharacters: string): string {
  const trimmed = value.trim();
  const digitsStart = trimmed.length - 4;
  if (
    digitsStart < 0 ||
    !hasFourDigits(trimmed.slice(digitsStart))
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
