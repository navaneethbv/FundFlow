/** Minimal RFC-4180 CSV builder. Quotes fields containing comma/quote/newline. */

/**
 * Spreadsheet formula injection guard: a string cell starting with = + - @ or a
 * tab/CR is executed as a formula by Excel/Sheets. Merchant names come from
 * bank data (attacker-influenced), so neutralize them with a leading apostrophe.
 * Numbers are passed through untouched (negative amounts stay negative).
 */
function neutralizeFormula(str: string): string {
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}

function escapeField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? neutralizeFormula(value) : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [headers.map(escapeField).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeField).join(","));
  }
  return lines.join("\r\n");
}
