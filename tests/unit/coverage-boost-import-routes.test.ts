import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn((_ctx: unknown, err: unknown) =>
  NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 500 }),
);
const mockBadRequest = vi.fn((msg: unknown) =>
  NextResponse.json({ error: String(msg) }, { status: 400 }),
);

vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (_ctx: unknown, err: unknown) => mockErrorResponse(_ctx, err),
  badRequest: (msg: unknown) => mockBadRequest(msg),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(() => Promise.resolve(true));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => mockCheckRateLimit(),
}));

let mockServiceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/recurring-inference", () => ({
  refreshInferredRecurringForUser: vi.fn(),
}));

import { POST as commitPost } from "@/app/api/import/commit/route";
import { POST as configPost } from "@/app/api/import/config/route";
import { POST as csvPost } from "@/app/api/import/csv/route";

function makeJsonReq(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as NextRequest;
}

function makeFormReq(formData: FormData): NextRequest {
  return {
    formData: () => Promise.resolve(formData),
    headers: new Headers(),
  } as unknown as NextRequest;
}

describe("Import and Config Routes Coverage Boost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
    mockServiceClient = clientStub();
  });

  describe("app/api/import/commit/route.ts", () => {
    it("handles rate limit exceeded", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: clientStub() });
      mockCheckRateLimit.mockResolvedValue(false);

      const res = await commitPost(
        makeJsonReq({ batch_id: "b1", account_id: "acc1", approved_row_ids: ["r1"] }),
      );
      expect(res.status).toBe(429);
    });

    it("persistedMappingTarget and resolveSourceAccountMappings with database mappings", async () => {
      const authClient = {
        from: vi.fn((table: string) => {
          if (table === "import_review_batches") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: "batch-1", created_at: new Date().toISOString() },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "accounts") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { id: "acc-1" }, error: null }),
                  }),
                }),
                in: () => ({
                  eq: async () => ({ data: [{ id: "acc-1" }], error: null }),
                }),
              }),
            };
          }
          if (table === "manual_accounts") {
            return {
              select: () => ({
                in: () => ({
                  eq: async () => ({ data: [{ id: "man-1" }], error: null }),
                }),
              }),
            };
          }
          if (table === "import_review_rows") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      order: () => ({
                        range: async () => ({
                          data: [
                            {
                              id: "row-1",
                              date: "2026-01-01",
                              description: "Coffee",
                              amount: 50,
                              category: "Food",
                              source_account: "Checking 1",
                              notes: "note1",
                              tags: ["b", "a"],
                              row_index: 0,
                              status: "pending",
                            },
                            {
                              id: "row-2",
                              date: "2026-01-02",
                              description: "Bakery",
                              amount: 20,
                              category: "Food",
                              source_account: "Savings 1",
                              notes: null,
                              tags: [],
                              row_index: 1,
                              status: "pending",
                            },
                          ],
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "import_source_account_mappings") {
            return {
              select: () => ({
                in: () => ({
                  eq: async () => ({
                    data: [
                      { source_account: "Checking 1", account_id: "acc-1" },
                      { source_account: "Savings 1", manual_account_id: "man-1" },
                    ],
                    error: null,
                  }),
                }),
              }),
            };
          }
          return { select: () => ({}) };
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      mockServiceClient = clientStub({
        transactions: {
          data: [{ id: "t1", plaid_transaction_id: "import-acc-1-2026-01-01-Coffee-0" }],
        },
        transaction_annotations: {
          data: [{ transaction_id: "t1", note: "note1", tags: ["a", "b"] }],
        },
      });

      const res = await commitPost(
        makeJsonReq({
          batch_id: "batch-1",
          account_id: "acc-1",
          approved_row_ids: ["row-1", "row-2"],
          account_mappings: {
            "Savings 1": { manual_account_id: "man-1" },
          },
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.imported).toBe(2);
    });

    it("detects newer annotation conflicts and returns 409", async () => {
      const batchCreatedAt = "2026-01-01T00:00:00.000Z";
      const authClient = {
        from: vi.fn((table: string) => {
          if (table === "import_review_batches") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: "batch-1", created_at: batchCreatedAt },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "accounts") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { id: "acc-1" }, error: null }),
                  }),
                }),
                in: () => ({
                  eq: async () => ({ data: [{ id: "acc-1" }], error: null }),
                }),
              }),
            };
          }
          if (table === "import_review_rows") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      order: () => ({
                        range: async () => ({
                          data: [
                            {
                              id: "row-1",
                              date: "2026-01-01",
                              description: "Coffee",
                              amount: 50,
                              category: "Food",
                              source_account: "Checking",
                              notes: "new note",
                              tags: ["tag2", "tag1"],
                              row_index: 0,
                              status: "pending",
                            },
                          ],
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "import_source_account_mappings") {
            return {
              select: () => ({
                in: () => ({
                  eq: async () => ({ data: [], error: null }),
                }),
              }),
            };
          }
          return { select: () => ({}) };
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      mockServiceClient = {
        from: vi.fn((table: string) => {
          if (table === "transactions") {
            return {
              select: () => ({
                in: (_col: string, ids: string[]) => ({
                  eq: async () => ({
                    data: ids.map((id, index) => ({
                      id: `txn-${index + 1}`,
                      plaid_transaction_id: id,
                    })),
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "transaction_annotations") {
            return {
              select: () => ({
                in: () => ({
                  eq: async () => ({
                    data: [
                      {
                        transaction_id: "txn-1",
                        updated_at: "2026-01-02T00:00:00.000Z", // newer than batch
                        note: "different note",
                        tags: ["tag1"],
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      } as unknown as ReturnType<typeof clientStub>;

      const res = await commitPost(
        makeJsonReq({
          batch_id: "batch-1",
          account_id: "acc-1",
          approved_row_ids: ["row-1"],
        }),
      );
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toBe("Some rows were edited in FundFlow after this import started.");
      expect(json.conflicts).toEqual(["row-1"]);
    });

    it("allows committing conflicting annotations when explicitly approved in overwriteAnnotationIds", async () => {
      const batchCreatedAt = "2026-01-01T00:00:00.000Z";
      const authClient = {
        from: vi.fn((table: string) => {
          if (table === "import_review_batches") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: "batch-1", created_at: batchCreatedAt },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "accounts") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { id: "acc-1" }, error: null }),
                  }),
                }),
                in: () => ({
                  eq: async () => ({ data: [{ id: "acc-1" }], error: null }),
                }),
              }),
            };
          }
          if (table === "import_review_rows") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      order: () => ({
                        range: async () => ({
                          data: [
                            {
                              id: "row-1",
                              date: "2026-01-01",
                              description: "Coffee",
                              amount: 50,
                              category: "Food",
                              source_account: "Checking",
                              notes: "new note",
                              tags: ["tag1"],
                              row_index: 0,
                              status: "pending",
                            },
                          ],
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "import_source_account_mappings") {
            return {
              select: () => ({
                in: () => ({
                  eq: async () => ({
                    data: [{ source_account: "Checking", other: "ignored" }],
                    error: null,
                  }),
                }),
              }),
            };
          }
          return { select: () => ({}) };
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      mockServiceClient = {
        from: vi.fn((table: string) => {
          if (table === "transactions") {
            return {
              select: () => ({
                in: (_col: string, ids: string[]) => ({
                  eq: async () => ({
                    data: ids.map((id, index) => ({
                      id: `txn-${index + 1}`,
                      plaid_transaction_id: id,
                    })),
                    error: null,
                  }),
                }),
              }),
              upsert: async () => ({ error: null }),
            };
          }
          if (table === "transaction_annotations") {
            return {
              select: () => ({
                in: () => ({
                  eq: async () => ({
                    data: [
                      {
                        transaction_id: "txn-1",
                        updated_at: "2026-01-02T00:00:00.000Z",
                        note: "new note",
                        tags: ["tag1"],
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
              upsert: async () => ({ error: null }),
            };
          }
          if (table === "import_source_account_mappings") {
            return { upsert: async () => ({ error: null }) };
          }
          if (table === "import_review_batches" || table === "import_review_rows") {
            return {
              update: () => ({
                eq: () => ({
                  in: async () => ({ error: null }),
                  eq: async () => ({ error: null }),
                }),
              }),
              delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
            };
          }
          return {};
        }),
      } as unknown as ReturnType<typeof clientStub>;

      const res = await commitPost(
        makeJsonReq({
          batch_id: "batch-1",
          account_id: "acc-1",
          approved_row_ids: ["row-1"],
          overwrite_annotation_row_ids: ["row-1"],
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.imported).toBe(1);
    });

    it("rejects when multiple source accounts exist and one is unmapped", async () => {
      const authClient = {
        from: vi.fn((table: string) => {
          if (table === "import_review_batches") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: "batch-1", created_at: new Date().toISOString() },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "accounts") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { id: "acc-1" }, error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === "import_review_rows") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      order: () => ({
                        range: async () => ({
                          data: [
                            {
                              id: "row-1",
                              date: "2026-01-01",
                              description: "Coffee",
                              amount: 50,
                              source_account: "Account A",
                              status: "pending",
                            },
                            {
                              id: "row-2",
                              date: "2026-01-02",
                              description: "Bakery",
                              amount: 20,
                              source_account: "Account B",
                              status: "pending",
                            },
                          ],
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "import_source_account_mappings") {
            return {
              select: () => ({
                in: () => ({
                  eq: async () => ({ data: [], error: null }),
                }),
              }),
            };
          }
          return { select: () => ({}) };
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      const res = await commitPost(
        makeJsonReq({
          batch_id: "batch-1",
          account_id: "acc-1",
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Choose a FundFlow account for source account");
    });

    it("rejects when an owned account is missing from the database", async () => {
      const authClient = {
        from: vi.fn((table: string) => {
          if (table === "import_review_batches") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: "batch-1", created_at: new Date().toISOString() },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "accounts") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { id: "acc-default" }, error: null }),
                  }),
                }),
                in: () => ({
                  eq: async () => ({ data: [], error: null }), // Missing mapped target
                }),
              }),
            };
          }
          if (table === "import_review_rows") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      order: () => ({
                        range: async () => ({
                          data: [
                            {
                              id: "row-1",
                              date: "2026-01-01",
                              description: "Coffee",
                              amount: 50,
                              category: "Food",
                              source_account: "Checking 2",
                              notes: null,
                              tags: [],
                              row_index: 0,
                              status: "pending",
                            },
                          ],
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "import_source_account_mappings") {
            return {
              select: () => ({
                in: () => ({
                  eq: async () => ({
                    data: [{ source_account: "Checking 2", account_id: "acc-missing" }],
                    error: null,
                  }),
                }),
              }),
            };
          }
          return { select: () => ({}) };
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      const res = await commitPost(
        makeJsonReq({
          batch_id: "batch-1",
          account_id: "acc-default",
          approved_row_ids: ["row-1"],
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("One or more mapped accounts are not available");
    });

    it("rejects when an owned manual account is missing from the database", async () => {
      const authClient = {
        from: vi.fn((table: string) => {
          if (table === "import_review_batches") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: "batch-1", created_at: new Date().toISOString() },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "accounts") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { id: "acc-default" }, error: null }),
                  }),
                }),
                in: () => ({
                  eq: async () => ({ data: [{ id: "acc-default" }], error: null }),
                }),
              }),
            };
          }
          if (table === "manual_accounts") {
            return {
              select: () => ({
                in: () => ({
                  eq: async () => ({ data: [], error: null }), // Missing manual target
                }),
              }),
            };
          }
          if (table === "import_review_rows") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      order: () => ({
                        range: async () => ({
                          data: [
                            {
                              id: "row-1",
                              date: "2026-01-01",
                              description: "Coffee",
                              amount: 50,
                              category: "Food",
                              source_account: "Cash",
                              notes: null,
                              tags: [],
                              row_index: 0,
                              status: "pending",
                            },
                          ],
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "import_source_account_mappings") {
            return {
              select: () => ({
                in: () => ({
                  eq: async () => ({
                    data: [{ source_account: "Cash", manual_account_id: "man-missing" }],
                    error: null,
                  }),
                }),
              }),
            };
          }
          return { select: () => ({}) };
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      const res = await commitPost(
        makeJsonReq({
          batch_id: "batch-1",
          account_id: "acc-default",
          approved_row_ids: ["row-1"],
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("One or more mapped manual accounts are not available");
    });
  });

  describe("app/api/import/config/route.ts", () => {
    it("handles replace-month decision creating category budget and writing monthly plan", async () => {
      const authClient = {
        from: vi.fn((table: string) => {
          if (table === "budgets") {
            return {
              select: () => ({
                eq: async () => ({ data: [], error: null }),
              }),
              insert: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: { id: "new-budget-id" }, error: null }),
                }),
              }),
            };
          }
          if (table === "budget_periods") {
            return {
              upsert: async () => ({ error: null }),
            };
          }
          return { select: () => ({}) };
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      const MONARCH_DATA = JSON.stringify({
        groups: [
          {
            name: "Living",
            categories: [{ name: "Groceries", amount: 600 }],
          },
        ],
      });

      const res = await configPost(
        makeJsonReq({
          kind: "budget",
          text: MONARCH_DATA,
          mode: "apply",
          decisions: {
            Groceries: "replace-month",
          },
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.created).toBe(1);
    });

    it("throws if created budget insert does not return an id", async () => {
      const authClient = {
        from: vi.fn((table: string) => {
          if (table === "budgets") {
            return {
              select: () => ({
                eq: async () => ({ data: [], error: null }),
              }),
              insert: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            };
          }
          return { select: () => ({}) };
        }),
      };
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      const MONARCH_DATA = JSON.stringify({
        groups: [
          {
            name: "Living",
            categories: [{ name: "Groceries", amount: 600 }],
          },
        ],
      });

      const res = await configPost(
        makeJsonReq({
          kind: "budget",
          text: MONARCH_DATA,
          mode: "apply",
          decisions: {
            Groceries: "replace-month",
          },
        }),
      );

      expect(res.status).toBe(500);
    });

    it("rejects when goal target amount is invalid in update decision", async () => {
      const authClient = clientStub({
        goals: {
          data: [
            {
              id: "g1",
              name: "Emergency Fund",
              goal_type: "save_up",
              target_amount: 10000,
              current_amount: 2000,
              target_date: null,
              category: "savings",
              color: null,
            },
          ],
        },
        accounts: {
          data: [],
        },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      const MONARCH_GOAL_INVALID_TARGET = JSON.stringify({
        goals: [
          {
            id: "m-goal-1",
            name: "Emergency Fund",
            type: "save_up",
            target_amount: 0, // Non-positive -> providedFields.targetAmount = true, targetAmount = null
          },
        ],
      });

      const res = await configPost(
        makeJsonReq({
          kind: "goal",
          text: MONARCH_GOAL_INVALID_TARGET,
          mode: "apply",
          decisions: {
            "goal:0": "merge",
          },
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("positive");
    });
  });

  describe("app/api/import/csv/route.ts", () => {
    it("successfully validates manual account ownership", async () => {
      const authClient = clientStub({
        manual_accounts: {
          data: { id: "man-123" },
        },
      });
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: authClient });

      mockServiceClient = clientStub({
        transactions: {
          data: null, // No synced boundary -> boundary is null, so rows dated 2026-01-01 are not skipped
        },
      });

      const form = new FormData();
      form.append("manual_account_id", "man-123");
      form.append(
        "file",
        new File(["Date,Description,Amount\n2026-01-01,Coffee,-4.50\n"], "test.csv", {
          type: "text/csv",
        }),
      );

      const res = await csvPost(makeFormReq(form));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.imported).toBe(1);
    });

    it("rejects when rate limit is exceeded on csv import", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: clientStub() });
      mockCheckRateLimit.mockResolvedValue(false);

      const form = new FormData();
      form.append("manual_account_id", "man-123");
      form.append(
        "file",
        new File(["Date,Description,Amount\n2026-01-01,Coffee,-4.50\n"], "test.csv", {
          type: "text/csv",
        }),
      );

      const res = await csvPost(makeFormReq(form));
      expect(res.status).toBe(429);
    });
  });
});
