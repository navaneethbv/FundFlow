import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";

const { states, fetchMock, getUserMock, refreshMock } = vi.hoisted(() => ({
  states: { values: [] as unknown[], index: 0 },
  fetchMock: vi.fn(),
  getUserMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = states.index++;
    if (!(index in states.values)) states.values[index] = initial;
    return [states.values[index], (value: unknown) => {
      states.values[index] = typeof value === "function" ? value(states.values[index]) : value;
    }];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: getUserMock } }) }));

import BayesCategorizeButton from "@/components/transactions/BayesCategorizeButton";
import BudgetTemplateButton from "@/components/budget/BudgetTemplateButton";
import HouseholdSection from "@/components/settings/HouseholdSection";
import ManualAccountsSection from "@/components/settings/ManualAccountsSection";
import ScheduledTransactionsSection from "@/components/transactions/ScheduledTransactionsSection";

type ElementProps = { children?: unknown; role?: string; onClick?: () => void; onSubmit?: (event: unknown) => Promise<void> };
function elements(node: unknown): Array<{ type: unknown; props: ElementProps }> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function click(tree: unknown, label: string) {
  const button = elements(tree).find((node) => node.props.children === label && node.props.onClick);
  expect(button, `button ${label}`).toBeDefined();
  button!.props.onClick!();
}

beforeEach(() => {
  states.index = 0;
  states.values = [];
  fetchMock.mockReset();
  getUserMock.mockReset();
  refreshMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Bayes categorization feedback", () => {
  it.each([
    [true, { applied: 3 }, "Categorized 3 rows."],
    [true, { applied: 0 }, "No confident categories found."],
    [true, { reason: "insufficient_training" }, "Bayes categorization unavailable: insufficient training."],
    [false, { error: "Try later" }, "Try later"],
    [false, {}, "Categorization failed."],
  ])("announces the result and allows another attempt", async (ok, payload, message) => {
    fetchMock.mockResolvedValue({ ok, json: async () => payload });
    click(BayesCategorizeButton(), "Categorize uncategorized");
    await vi.waitFor(() => expect(states.values[1]).toBe(message));
    expect(states.values[0]).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("/api/categorization/bayes", { method: "POST" });
  });

  it.each([
    [new Error("Network unavailable"), "Network unavailable"],
    [null, "Categorization failed."],
  ])("reports transport failures and clears the busy state", async (error, message) => {
    fetchMock.mockRejectedValue(error);
    click(BayesCategorizeButton(), "Categorize uncategorized");
    await vi.waitFor(() => expect(states.values[1]).toBe(message));
    expect(states.values[0]).toBe(false);
  });
});

describe("budget template transport failures", () => {
  it.each(["Save", "Apply", "Delete"])("reports a failed %s and clears the busy state", async (action) => {
    states.values = [false, [{ id: "template-1", name: "Travel", items: [] }], "Travel"];
    fetchMock.mockRejectedValue(new Error("Network unavailable"));
    click(BudgetTemplateButton({ month: "2026-10", currentLines: [{ category: "TRAVEL", group: "flexible", basePlanned: 100, rolloverEnabled: false }] }), action);
    await vi.waitFor(() => expect(states.values[5]).toBe("Network unavailable"));
    expect(states.values[3]).toBe(false);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("household transport failures", () => {
  it("reports a failed sign-in check and clears the busy state", async () => {
    states.values = [[], "Family"];
    getUserMock.mockRejectedValue(new Error("Network unavailable"));
    click(HouseholdSection({ initialHouseholds: [] }), "Create");
    await vi.waitFor(() => expect(states.values[2]).toBe("Network unavailable"));
    expect(states.values[3]).toBe(false);
    expect(states.values[0]).toEqual([]);
  });

  it("keeps the invite address after a failed request and allows retry", async () => {
    fetchMock.mockRejectedValue(new Error("Network unavailable"));
    const tree = HouseholdSection({ initialHouseholds: [{ id: "household-1", name: "Family" }] });
    const form = elements(tree).find((node) => node.type === "form");
    const emailInput = { value: "partner@example.com" };
    await form!.props.onSubmit!({ preventDefault: vi.fn(), currentTarget: { elements: { namedItem: () => emailInput } } });
    expect(states.values[2]).toBe("Network unavailable");
    expect(states.values[3]).toBe(false);
    expect(emailInput.value).toBe("partner@example.com");
  });
});

describe("manual account transport failures", () => {
  it.each([
    [new Error("Network unavailable"), "Network unavailable"],
    [null, "Could not add the account."],
  ])("keeps the draft and allows retry after a failed add", async (error, message) => {
    states.values = [[], {}, "Savings", "cash", "125.50"];
    fetchMock.mockRejectedValue(error);
    const tree = ManualAccountsSection({ initialAccounts: [] });
    const form = elements(tree).find((node) => node.type === "form");
    await expect(form!.props.onSubmit!({ preventDefault: vi.fn() })).resolves.toBeUndefined();
    expect(states.values[5]).toBe(message);
    expect(states.values[7]).toBe(false);
    expect(states.values[0]).toEqual([]);
    expect(states.values[2]).toBe("Savings");
    expect(states.values[4]).toBe("125.50");
  });
});

const scheduledEntry = {
  id: "scheduled-1", kind: "debit" as const, amount: 25, merchant: "Library",
  date: "2026-10-15", category: null, notes: null, accountId: "account-1",
  manualAccountId: null, status: "scheduled",
};
const scheduledForm = {
  kind: "debit", amount: "25", merchant: "Library", date: "2026-10-15",
  accountKey: "plaid:account-1", category: "", notes: "",
};
const scheduledAccounts = [{ source: "plaid" as const, id: "account-1", name: "Checking" }];

describe("scheduled transaction failures", () => {
  it.each([
    [null, new Error("Network unavailable"), "Network unavailable"],
    [scheduledEntry, new Error("Network unavailable"), "Network unavailable"],
    [null, null, "Could not save the scheduled transaction."],
  ])("keeps the editor open and its draft after a failed save", async (editing, error, message) => {
    states.values = [[scheduledEntry], true, editing, { ...scheduledForm }];
    fetchMock.mockRejectedValue(error);
    const tree = ScheduledTransactionsSection({ accounts: scheduledAccounts });
    const form = elements(tree).find((node) => node.type === "form");
    await expect(form!.props.onSubmit!({ preventDefault: vi.fn() })).resolves.toBeUndefined();
    expect(states.values[4]).toBe(message);
    expect(states.values[5]).toBe(false);
    expect(states.values[1]).toBe(true);
    expect(states.values[3]).toEqual(scheduledForm);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it.each([
    [new Error("Network unavailable"), "Network unavailable"],
    [null, "Could not cancel the scheduled transaction."],
  ])("preserves the scheduled row and allows retry after a failed cancellation", async (error, message) => {
    states.values = [[scheduledEntry], false, null, { ...scheduledForm }];
    fetchMock.mockRejectedValue(error);
    click(ScheduledTransactionsSection({ accounts: scheduledAccounts }), "Cancel");
    await vi.waitFor(() => expect(states.values[4]).toBe(message));
    expect(states.values[5]).toBe(false);
    expect(states.values[0]).toEqual([scheduledEntry]);
    expect(refreshMock).not.toHaveBeenCalled();
    states.index = 0;
    const alert = elements(ScheduledTransactionsSection({ accounts: scheduledAccounts }))
      .find((node) => node.props.role === "alert");
    expect(alert?.props.children).toBe(message);
  });

  it.each([
    [{ error: "Already posted" }, "Already posted"],
    [{}, "Could not cancel the scheduled transaction."],
  ])("reports a rejected cancellation without refreshing away the existing row", async (payload, message) => {
    states.values = [[scheduledEntry], false, null, { ...scheduledForm }];
    fetchMock.mockResolvedValue({ ok: false, json: async () => payload });
    click(ScheduledTransactionsSection({ accounts: scheduledAccounts }), "Cancel");
    await vi.waitFor(() => expect(states.values[4]).toBe(message));
    expect(states.values[5]).toBe(false);
    expect(states.values[0]).toEqual([scheduledEntry]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("reloads and refreshes only after a successful cancellation", async () => {
    states.values = [[scheduledEntry], false, null, { ...scheduledForm }];
    fetchMock.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ json: async () => ({ scheduled: [] }) });
    click(ScheduledTransactionsSection({ accounts: scheduledAccounts }), "Cancel");
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
    expect(states.values[0]).toEqual([]);
    expect(states.values[4]).toBeNull();
    expect(states.values[5]).toBe(false);
  });
});
