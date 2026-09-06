import {
  looksLikeMonarchCsv as looksLikeMonarchCsvImpl,
  parseMonarchCsv as parseMonarchCsvImpl,
  MONARCH_FORMAT_SPEC as MONARCH_FORMAT_SPEC_IMPL,
  type DateOrder,
  type ImportParseResult,
} from "./import";

export const MONARCH_FORMAT_SPEC = MONARCH_FORMAT_SPEC_IMPL;

export function looksLikeMonarchCsv(headerRow: string[]): boolean {
  return looksLikeMonarchCsvImpl(headerRow);
}

export function parseMonarchCsv(
  text: string,
  options: { dateOrder?: DateOrder; requireDateOrder?: boolean } = {},
): ImportParseResult & { requiresDateOrder?: boolean } {
  return parseMonarchCsvImpl(text, options);
}