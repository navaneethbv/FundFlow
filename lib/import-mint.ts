import {
  looksLikeMintCsv as looksLikeMintCsvImpl,
  parseMintCsv as parseMintCsvImpl,
  type DateOrder,
  type ImportParseResult,
} from "./import";

export { MINT_FORMAT_SPEC } from "./import";

export function looksLikeMintCsv(headerRow: string[]): boolean {
  return looksLikeMintCsvImpl(headerRow);
}

export function parseMintCsv(
  text: string,
  options: { dateOrder?: DateOrder; requireDateOrder?: boolean } = {},
): ImportParseResult & { requiresDateOrder?: boolean } {
  return parseMintCsvImpl(text, options);
}