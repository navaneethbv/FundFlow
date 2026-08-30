/**
 * Sanitizes external account / merchant display names that may contain
 * Unicode replacement characters (\uFFFD / \uFFFE) from corrupted upstream feeds.
 * Normalizes to Unicode NFC, removes replacement characters, collapses extra
 * whitespace, and trims. Returns null if no visible text remains.
 */
export function normalizeExternalDisplayText(
  value: string | null | undefined,
): string | null {
  if (!value) return null;

  // Normalize to canonical Unicode NFC
  const nfc = value.normalize("NFC");

  // Strip replacement characters (\uFFFD, \uFFFE, and control replacement artifacts)
  const stripped = nfc.replace(/[\uFFFD\uFFFE]/g, " ");

  // Collapse multiple whitespace characters into a single space and trim
  const cleaned = stripped.replace(/\s+/g, " ").trim();

  return cleaned.length > 0 ? cleaned : null;
}
