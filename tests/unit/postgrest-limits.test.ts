import { describe, expect, it } from "vitest";
import { chunkValues, IN_FILTER_CHUNK_SIZE } from "@/lib/postgrest-limits";

describe("PostgREST in() budget", () => {
  it("keeps a full chunk of UUIDs under an 8KB request line", () => {
    const uuid = "00000000-0000-4000-8000-000000000000";
    const list = Array.from({ length: IN_FILTER_CHUNK_SIZE }, () => uuid).join(",");
    const path = `/rest/v1/transaction_splits?select=transaction_id,category,amount&transaction_id=in.(${list})&user_id=eq.${uuid}&order=id.asc&offset=0&limit=1000`;
    expect(encodeURI(path).length).toBeLessThan(8 * 1024 - 512);
  });

  it("chunks values in order without dropping any", () => {
    const values = Array.from({ length: 2 * IN_FILTER_CHUNK_SIZE + 1 }, (_, i) => i);
    const chunks = chunkValues(values);
    expect(chunks.map((c) => c.length)).toEqual([IN_FILTER_CHUNK_SIZE, IN_FILTER_CHUNK_SIZE, 1]);
    expect(chunks.flat()).toEqual(values);
    expect(chunkValues([])).toEqual([]);
  });
});
