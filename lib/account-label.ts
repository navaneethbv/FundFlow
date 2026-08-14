function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
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
  return trimmed.slice(0, start).trimEnd();
}
