import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientStub } from "../fixtures/supabase-query";
import {
  loadRules,
  loadRuleCandidates,
  simulateCompoundRules,
  applyCompoundRules,
  processRuleAutomation,
  type StoredCompoundRule,
  type RuleCandidate,
} from "@/lib/compound-rule-service";
import {
  beginLegacyRuleRuns,
  finishLegacyRuleRuns,
} from "@/lib/rule-run-history";
import { attachLedgerRuleActions } from "@/lib/rule-ledger";
import {
  annotationProjectionColumns,
  storedRuleActions,
  validateRuleActions,
  tagsWithRuleActions,
} from "@/lib/rule-actions";
const flags = new Set<string>();
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (flag: string) => flags.has(flag),
}));
const client = (value: ReturnType<typeof clientStub>) =>
  value as unknown as SupabaseClient;
const rule = (patch: Partial<StoredCompoundRule> = {}): StoredCompoundRule => ({
  id: "r",
  match_type: "compound",
  pattern: "compound",
  conditions: { field: "merchant", operator: "contains", value: "shop" },
  actions: { category: "Food", tags: ["rule"] },
  amount_condition: null,
  display_name: null,
  category: null,
  tags: [],
  enabled: true,
  ...patch,
});
const candidate = (patch: Partial<RuleCandidate> = {}): RuleCandidate => ({
  id: "t",
  merchant: "Shop",
  amount: 50,
  version: "2026-10-01",
  annotationVersion: null,
  ...patch,
});
beforeEach(() => {
  flags.clear();
  flags.add("compoundRules");
  flags.add("ruleRunHistory");
});
describe("compound rule service", () => {
  it("loads owner rules in creation order with a hard count limit", async () => {
    const db = clientStub({ merchant_rules: { data: [rule()] } });
    expect(await loadRules(client(db), "owner")).toEqual([rule()]);
    expect(db.scopedToUser("merchant_rules", "owner")).toBe(true);
    expect(
      db
        .callsOn("merchant_rules")
        .filter((call) => call.method === "order")
        .map((call) => call.args[0]),
    ).toEqual(["created_at", "id"]);
    expect(await loadRules(client(clientStub()), "owner")).toEqual([]);
    await expect(
      loadRules(
        client(
          clientStub({ merchant_rules: { data: Array(101).fill(rule()) } }),
        ),
        "owner",
      ),
    ).rejects.toThrow("100 rules");
    await expect(
      loadRules(
        client(clientStub({ merchant_rules: { error: new Error("read") } })),
        "owner",
      ),
    ).rejects.toThrow("read");
  });
  it("loads posted facts and authored conditions, preserving signs and ids", async () => {
    const db = clientStub({
      transactions: {
        data: [
          {
            id: "t",
            merchant_name: "Shop",
            amount: "-42",
            account_id: "a",
            name: "POS",
            original_description: "RAW",
            pfc_primary: "TRANSFER_OUT",
            updated_at: "v",
          },
        ],
      },
      transaction_annotations: {
        data: [
          {
            transaction_id: "t",
            note: "trip",
            tags: ["mine"],
            display_category: "Manual",
            updated_at: "av",
            rule_actions: { exclude: true },
          },
        ],
      },
      accounts: { data: [{ id: "a", name: "Bank" }] },
    });
    const [row] = await loadRuleCandidates(
      client(db),
      "owner",
      { start: "2026-01-01", end: "2026-12-31" },
      ["t"],
    );
    expect(row).toMatchObject({
      accountId: "a",
      accountName: "Bank",
      amount: -42,
      type: "transfer",
      category: "Manual",
      notes: "trip",
      descriptor: "RAW",
      previousActions: { exclude: true },
      annotationVersion: "av",
    });
    for (const table of ["transactions", "transaction_annotations", "accounts"])
      expect(db.scopedToUser(table, "owner")).toBe(true);
  });
  it("handles manual accounts, unknown annotations and expense/income signs", async () => {
    const db = clientStub({
      transactions: {
        data: [
          { id: "t", amount: 3, manual_account_id: "m" },
          { id: "i", amount: -3 },
        ],
      },
    });
    const rows = await loadRuleCandidates(client(db), "owner", {
      start: "a",
      end: "z",
    });
    expect(rows[0]).toMatchObject({
      accountId: "m",
      accountName: "",
      type: "expense",
      annotationVersion: null,
      tags: [],
    });
    expect(rows[1]?.type).toBe("income");
    expect(
      await loadRuleCandidates(client(clientStub()), "owner", {
        start: "a",
        end: "z",
      }),
    ).toEqual([]);
    const empty = clientStub();
    expect(
      await loadRuleCandidates(
        client(empty),
        "owner",
        { start: "a", end: "z" },
        [],
      ),
    ).toEqual([]);
    expect(empty.from).not.toHaveBeenCalled();
  });
  it("refuses truncated inputs and every failed dependency", async () => {
    await expect(
      loadRuleCandidates(
        client(
          clientStub({ transactions: { data: Array(501).fill({ id: "t" }) } }),
        ),
        "o",
        { start: "a", end: "z" },
      ),
    ).rejects.toThrow("500 transactions");
    for (const table of [
      "transactions",
      "transaction_annotations",
      "accounts",
    ]) {
      const seeds = {
        transactions: { data: [{ id: "t", amount: 1 }] },
        [table]: { error: new Error(table) },
      };
      await expect(
        loadRuleCandidates(client(clientStub(seeds)), "o", {
          start: "a",
          end: "z",
        }),
      ).rejects.toThrow(table);
    }
  });
  it("retains first match ordering, refuses corrupt stored conditions and preserves legacy actions", () => {
    const legacy = rule({
      id: "legacy",
      match_type: "merchant",
      pattern: "Shop",
      conditions: null,
      actions: null,
      category: "Legacy",
      display_name: "Store",
      tags: ["old"],
    });
    expect(
      simulateCompoundRules([legacy, rule()], [candidate()]).results[0]
        ?.updated,
    ).toEqual({ merchant: "Store", category: "Legacy", tags: ["old"] });
    expect(() =>
      simulateCompoundRules([rule({ actions: null })], [candidate()]),
    ).toThrow("invalid");
  });
  it("makes flags a no-op for ingestion and materialization", async () => {
    flags.clear();
    const db = clientStub();
    expect(
      await applyCompoundRules(
        client(db),
        "o",
        "manual",
        [rule()],
        [candidate()],
      ),
    ).toBe(0);
    await processRuleAutomation(client(db), client(db), "o", "sync", [
      "provider",
    ]);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("records runs and uses one CAS RPC including source and annotation versions", async () => {
    const db = clientStub({
      rule_runs: { data: { id: "run" } },
      apply_compound_rule_run: { data: 1 },
    });
    expect(
      await applyCompoundRules(
        client(db),
        "owner",
        "manual",
        [rule()],
        [candidate()],
      ),
    ).toBe(1);
    expect(db.writtenTo("rule_runs")).toMatchObject({
      user_id: "owner",
      trigger: "manual",
      matched: 1,
    });
    expect(db.callsOnRpc("apply_compound_rule_run")[0]?.[0]).toEqual({
      p_user_id: "owner",
      p_run_id: "run",
      p_rows: [
        {
          id: "t",
          version: "2026-10-01",
          annotationVersion: null,
          actions: rule().actions,
          ruleId: "r",
        },
      ],
    });
  });
  it("applies only the selected rule while preserving earlier match priority", async () => {
    const db = clientStub({ apply_compound_rule_run: { data: 0 } });
    flags.delete("ruleRunHistory");
    await applyCompoundRules(
      client(db),
      "o",
      "manual",
      [rule({ id: "first" }), rule({ id: "second" })],
      [candidate()],
      "second",
    );
    expect(db.callsOnRpc("apply_compound_rule_run")[0]?.[0]).toMatchObject({
      p_run_id: null,
      p_rows: [],
    });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("does not newly materialize legacy rules during ingestion", async () => {
    const db = clientStub();
    const legacy = rule({
      match_type: "merchant",
      pattern: "Shop",
      conditions: null,
      actions: null,
    });
    await applyCompoundRules(client(db), "o", "sync", [legacy], [candidate()]);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("materializes legacy manual actions and handles an unmatched candidate", async () => {
    flags.delete("ruleRunHistory");
    const db = clientStub({ apply_compound_rule_run: { data: 1 } });
    await applyCompoundRules(
      client(db),
      "o",
      "manual",
      [
        rule({
          match_type: "merchant",
          pattern: "Shop",
          conditions: null,
          actions: null,
          display_name: "Store",
          category: "Food",
          tags: ["tag"],
        }),
      ],
      [candidate(), candidate({ id: "none", merchant: "Other" })],
    );
    expect(db.callsOnRpc("apply_compound_rule_run")[0]?.[0]).toMatchObject({
      p_rows: [
        { actions: { displayName: "Store", category: "Food", tags: ["tag"] } },
      ],
    });
  });
  it("keeps failure evidence, including failures in the journal", async () => {
    const db = clientStub({
      rule_runs: { data: { id: "run" } },
      apply_compound_rule_run: { error: new Error("conflict") },
    });
    await expect(
      applyCompoundRules(client(db), "o", "manual", [rule()], [candidate()]),
    ).rejects.toThrow("conflict");
    expect(db.callsOn("rule_runs")).toContainEqual({
      method: "update",
      args: [expect.objectContaining({ status: "failed" })],
    });
    expect(db.scopedToUser("rule_runs", "o")).toBe(true);
    const journalFail = clientStub({
      rule_runs: { error: new Error("journal") },
    });
    await expect(
      applyCompoundRules(
        client(journalFail),
        "o",
        "manual",
        [rule()],
        [candidate()],
      ),
    ).rejects.toThrow("journal");
    flags.delete("ruleRunHistory");
    await expect(
      applyCompoundRules(client(db), "o", "manual", [rule()], [candidate()]),
    ).rejects.toThrow("conflict");
  });
  it("processes committed provider ids, skips empty/no-compound batches and scopes lookups", async () => {
    const db = clientStub({
      merchant_rules: { data: [rule()] },
      transactions: { data: [{ id: "t", merchant_name: "Shop", amount: 2 }] },
      rule_runs: { data: { id: "run" } },
      apply_compound_rule_run: { data: 1 },
    });
    await processRuleAutomation(client(db), client(db), "o", "import", [
      "provider",
    ]);
    expect(db.callsOn("transactions")).toContainEqual({
      method: "in",
      args: ["plaid_transaction_id", ["provider"]],
    });
    expect(db.scopedToUser("transactions", "o")).toBe(true);
    const empty = clientStub();
    await processRuleAutomation(client(empty), client(empty), "o", "sync", []);
    expect(empty.from).not.toHaveBeenCalled();
    await processRuleAutomation(client(empty), client(empty), "o", "sync", [
      "p",
    ]);
    expect(empty.rpc).not.toHaveBeenCalled();
    const broken = clientStub({
      merchant_rules: { data: [rule()] },
      transactions: { error: new Error("lookup") },
    });
    await expect(
      processRuleAutomation(client(broken), client(broken), "o", "sync", ["p"]),
    ).rejects.toThrow("lookup");
  });
});
describe("rule effects and ledger projection inputs", () => {
  it("validates all action types and rejects malformed shapes", () => {
    expect(
      validateRuleActions({
        category: "Food",
        displayName: "Shop",
        tags: ["t"],
        exclude: false,
        transfer: true,
        notify: true,
      }),
    ).toBe(true);
    for (const invalid of [
      null,
      [],
      {},
      { bad: true },
      { tags: [""] },
      { tags: Array(21).fill("x") },
      { category: " " },
      { notify: "yes" },
    ])
      expect(validateRuleActions(invalid)).toBe(false);
    expect(storedRuleActions({})).toBeUndefined();
    expect(tagsWithRuleActions(["a"], { tags: ["a", "b"] })).toEqual([
      "a",
      "b",
    ]);
    expect(tagsWithRuleActions([])).toEqual([]);
    expect(annotationProjectionColumns("id")).toBe("id, rule_actions");
    flags.clear();
    expect(annotationProjectionColumns("id")).toBe("id");
  });
  it("loads derived actions in owner-scoped chunks and refuses failed reads", async () => {
    const db = clientStub({
      transaction_annotations: {
        data: [
          {
            transaction_id: "t",
            display_category: "Manual",
            rule_actions: { exclude: true },
          },
        ],
      },
    });
    expect(
      await attachLedgerRuleActions(client(db), "owner", [
        { id: "t" },
        { id: "n" },
      ]),
    ).toEqual([
      { id: "t", manualCategory: "Manual", ruleActions: { exclude: true } },
      { id: "n" },
    ]);
    expect(db.scopedToUser("transaction_annotations", "owner")).toBe(true);
    const failed = clientStub({
      transaction_annotations: { error: new Error("read") },
    });
    await expect(
      attachLedgerRuleActions(client(failed), "o", [{ id: "t" }]),
    ).rejects.toThrow("read");
    flags.clear();
    expect(
      await attachLedgerRuleActions(client(failed), "o", [{ id: "t" }]),
    ).toEqual([{ id: "t" }]);
    flags.add("compoundRules");
    expect(await attachLedgerRuleActions(client(failed), "o", [])).toEqual([]);
  });
});
describe("legacy batch run history", () => {
  const simulation = {
    totalEvaluated: 1,
    matchedCount: 1,
    modifiedCount: 1,
    results: [
      {
        transactionId: "t",
        matchedRuleId: "r",
        modified: true,
        original: { merchant: "Shop", category: null, tags: [] },
        updated: { merchant: "Shop", category: "Food", tags: [] },
      },
    ],
  };
  it("records per-rule results and provenance on success", async () => {
    const db = clientStub({
      rule_runs: { data: [{ id: "run", rule_id: "r" }] },
    });
    const runs = await beginLegacyRuleRuns(
      client(db),
      "o",
      [{ id: "r", matchType: "merchant", pattern: "Shop" }],
      simulation,
    );
    await finishLegacyRuleRuns(client(db), "o", runs, simulation, "success");
    expect(db.writtenTo("rule_changes")).toEqual([
      { user_id: "o", run_id: "run", transaction_id: "t" },
    ]);
    expect(db.callsOn("rule_runs")).toContainEqual({
      method: "update",
      args: [expect.objectContaining({ changed: 1, status: "success" })],
    });
  });
  it("keeps failed counts unknown and does not claim provenance for partial legacy writes", async () => {
    const db = clientStub();
    await finishLegacyRuleRuns(
      client(db),
      "o",
      [{ id: "run", rule_id: "r" }],
      simulation,
      "failed",
    );
    expect(db.writtenTo("rule_runs")).toMatchObject({
      status: "failed",
      changed: null,
    });
    expect(db.from).not.toHaveBeenCalledWith("rule_changes");
    flags.clear();
    expect(await beginLegacyRuleRuns(client(db), "o", [], simulation)).toEqual(
      [],
    );
    flags.add("ruleRunHistory");
    expect(await beginLegacyRuleRuns(client(db), "o", [], simulation)).toEqual(
      [],
    );
  });
  it("surfaces journal and provenance failures", async () => {
    const bad = client(
      clientStub({ rule_runs: { error: new Error("write") } }),
    );
    await expect(
      beginLegacyRuleRuns(
        bad,
        "o",
        [{ id: "r", matchType: "merchant", pattern: "x" }],
        simulation,
      ),
    ).rejects.toThrow("write");
    await expect(
      finishLegacyRuleRuns(
        bad,
        "o",
        [{ id: "run", rule_id: "r" }],
        simulation,
        "failed",
      ),
    ).rejects.toThrow("write");
    await expect(
      finishLegacyRuleRuns(
        client(clientStub({ rule_changes: { error: new Error("changes") } })),
        "o",
        [{ id: "run", rule_id: "r" }],
        simulation,
        "success",
      ),
    ).rejects.toThrow("changes");
  });
});
