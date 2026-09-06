import {
  looksLikeYnabCsv as looksLikeYnabCsvImpl,
  parseYnabCsv as parseYnabCsvImpl,
  type DateOrder,
  type ImportParseResult,
} from "./import";

export { YNAB_FORMAT_SPEC } from "./import";

export function looksLikeYnabCsv(headerRow: string[]): boolean {
  return looksLikeYnabCsvImpl(headerRow);
}

export function parseYnabCsv(
  text: string,
  options: { dateOrder?: DateOrder; requireDateOrder?: boolean } = {},
): ImportParseResult & { requiresDateOrder?: boolean } {
  return parseYnabCsvImpl(text, options);
}