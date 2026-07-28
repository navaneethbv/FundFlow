import { vi } from "vitest";

/**
 * Chainable Supabase query stub for route-handler tests.
 *
 * Every builder method returns the same object and the object is thenable, so
 * one stub stands in for any select/eq/in/order/limit/maybeSingle chain a
 * route happens to use, in any order. Calls are recorded so a test can assert
 * on scoping (`user_id` filters especially) rather than only on the response.
 */
export type QueryCall = { method: string; args: unknown[] };

export type QueryStub = {
  calls: QueryCall[];
  then: (resolve: (value: QueryResult) => unknown) => unknown;
} & Record<string, (...args: unknown[]) => unknown>;

/** `count` is what a `{ count: "exact", head: true }` select resolves with. */
export type QueryResult = { data?: unknown; error?: unknown; count?: number };

const BUILDER_METHODS = [
  "select",
  "insert",
  "update",
  "upsert",
  "delete",
  "eq",
  "neq",
  "is",
  "in",
  "like",
  "ilike",
  "not",
  "or",
  "filter",
  "range",
  "contains",
  "gte",
  "lte",
  "lt",
  "gt",
  "order",
  "limit",
  "maybeSingle",
  "single",
];

export function queryStub(result: QueryResult = {}): QueryStub {
  const calls: QueryCall[] = [];
  const builder = {
    calls,
    then: (resolve: (value: QueryResult) => unknown) => resolve(result),
  } as QueryStub;
  for (const method of BUILDER_METHODS) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  return builder;
}

/**
 * A Supabase client whose `from(table)` returns a per-table {@link queryStub}.
 * Seed results per table; unseeded tables resolve to `{ data: null }`.
 */
export function clientStub(seeds: Record<string, QueryResult> = {}) {
  const tables: Record<string, QueryStub> = {};
  const client = {
    from: vi.fn((table: string) => {
      tables[table] ??= queryStub(seeds[table] ?? { data: null });
      return tables[table];
    }),
    tables,
    /** Every call recorded against `table`, or [] if it was never touched. */
    callsOn: (table: string) => tables[table]?.calls ?? [],
    /** Was `table` filtered by this user id? */
    scopedToUser: (table: string, userId: string) =>
      (tables[table]?.calls ?? []).some(
        ({ method, args }) =>
          method === "eq" && args[0] === "user_id" && args[1] === userId,
      ),
    /** The payload passed to insert/update/upsert on `table`. */
    writtenTo: (table: string) =>
      (tables[table]?.calls ?? []).find(({ method }) =>
        ["insert", "update", "upsert"].includes(method),
      )?.args[0],
  };
  return client;
}
