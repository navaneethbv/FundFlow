import {
  looksLikeMonarchCsv as looksLikeMonarchCsvImpl,
  parseMonarchCsv as parseMonarchCsvImpl,
  type DateOrder,
  type ImportParseResult,
} from "./import";

export { MONARCH_FORMAT_SPEC } from "./import";

export function looksLikeMonarchCsv(headerRow: string[]): boolean {
  return looksLikeMonarchCsvImpl(headerRow);
}

export function parseMonarchCsv(
  text: string,
  options: { dateOrder?: DateOrder; requireDateOrder?: boolean } = {},
): ImportParseResult & { requiresDateOrder?: boolean } {
  return parseMonarchCsvImpl(text, options);
}