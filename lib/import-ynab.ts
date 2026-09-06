import {
  looksLikeYnabCsv as looksLikeYnabCsvImpl,
  parseYnabCsv as parseYnabCsvImpl,
  YNAB_FORMAT_SPEC as YNAB_FORMAT_SPEC_IMPL,
  type DateOrder,
  type ImportParseResult,
} from "./import";

export const YNAB_FORMAT_SPEC = YNAB_FORMAT_SPEC_IMPL;

export function looksLikeYnabCsv(headerRow: string[]): boolean {
  return looksLikeYnabCsvImpl(headerRow);
}

export function parseYnabCsv(
  text: string,
  options: { dateOrder?: DateOrder; requireDateOrder?: boolean } = {},
): ImportParseResult & { requiresDateOrder?: boolean } {
  return parseYnabCsvImpl(text, options);
}