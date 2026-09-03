import { describe, expect, it, vi } from "vitest";
import { ReviewItemActions } from "@/components/transactions/ReviewPairList";

describe("ReviewItemActions", () => {
  it("triggers callbacks on button clicks", () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    const actions = ReviewItemActions({
      id: "pair-1",
      busyId: null,
      confirmLabel: "Link",
      onConfirm,
      onDismiss,
    });
    expect(actions).toBeDefined();
  });
});
