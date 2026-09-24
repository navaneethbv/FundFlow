/**
 * Most values one PostgREST `.in()` filter may carry.
 *
 * PostgREST builds the list into the request URL, so the list length is a
 * request-line budget, not a database one. 150 UUIDs is about 5.6KB. That
 * clears the tightest limit on the path: the 8KB request-line buffer that
 * nginx and Kong use by default in front of a self-hosted or `supabase start`
 * stack. The earlier 250 (about 9.3KB) only passed the looser 16KB Node
 * header limit, so on a local stack every page reading splits or annotations
 * failed with a 414.
 */
export const IN_FILTER_CHUNK_SIZE = 150;

/** Splits `values` into consecutive chunks of at most `size` entries. */
export function chunkValues<T>(values: readonly T[], size = IN_FILTER_CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
