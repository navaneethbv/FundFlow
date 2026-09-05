import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import {
  areTransferReviewActionsDisabled,
  getTransferSelectionState,
  selectAllTransferSuggestions,
  toggleTransferSelection,
} from "@/components/transactions/TransferReview";

const pairs = [{ subject_id: "pair-a" }, { subject_id: "pair-b" }, { subject_id: "pair-c" }];

describe("transfer review selection", () => {
  it("selects and clears every visible suggestion", () => {
    const all = selectAllTransferSuggestions(pairs, true);
    expect(getTransferSelectionState(pairs, all)).toEqual({
      selectedCount: 3,
      allSelected: true,
      indeterminate: false,
    });

    const none = selectAllTransferSuggestions(pairs, false);
    expect(getTransferSelectionState(pairs, none)).toEqual({
      selectedCount: 0,
      allSelected: false,
      indeterminate: false,
    });
  });

  it("tracks an indeterminate selection when the visible rows change", () => {
    const selected = toggleTransferSelection(new Set<string>(), "pair-a");
    expect(getTransferSelectionState(pairs, selected)).toMatchObject({
      selectedCount: 1,
      allSelected: false,
      indeterminate: true,
    });

    const remainingPairs = pairs.slice(0, 1);
    expect(getTransferSelectionState(remainingPairs, selected)).toMatchObject({
      selectedCount: 1,
      allSelected: true,
      indeterminate: false,
    });
  });

  it("returns a fresh set and disables actions while any request is active", () => {
    const initial = new Set(["pair-a"]);
    const next = toggleTransferSelection(initial, "pair-b");
    expect(next).toEqual(new Set(["pair-a", "pair-b"]));
    expect(initial).toEqual(new Set(["pair-a"]));
    expect(areTransferReviewActionsDisabled(new Set())).toBe(false);
    expect(areTransferReviewActionsDisabled(new Set(["pair-a"]))).toBe(true);
  });
});
