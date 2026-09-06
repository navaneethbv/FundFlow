import {
  looksLikeMintCsv as looksLikeMintCsvImpl,
  parseMintCsv as parseMintCsvImpl,
  MINT_FORMAT_SPEC as MINT_FORMAT_SPEC_IMPL,
  type DateOrder,
  type ImportParseResult,
} from "./import";

export const MINT_FORMAT_SPEC = MINT_FORMAT_SPEC_IMPL;

export function looksLikeMintCsv(headerRow: string[]): boolean {
  return looksLikeMintCsvImpl(headerRow);
}

export function parseMintCsv(
  text: string,
  options: { dateOrder?: DateOrder; requireDateOrder?: boolean } = {},
): ImportParseResult & { requiresDateOrder?: boolean } {
  return parseMintCsvImpl(text, options);
}