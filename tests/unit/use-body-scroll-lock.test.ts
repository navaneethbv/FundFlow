import { describe, it, expect, vi, beforeEach } from "vitest";

let effectFn: (() => void) | null = null;
let effectCleanup: (() => void) | void;

vi.mock("react", () => ({
  useEffect: (fn: () => void | (() => void)) => {
    effectFn = () => {
      effectCleanup = fn();
    };
  },
}));

import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

describe("useBodyScrollLock", () => {
  beforeEach(() => {
    effectFn = null;
    effectCleanup = undefined;
    if (typeof document !== "undefined") {
      document.body.style.overflow = "";
    } else {
      (globalThis as unknown as { document: { body: { style: { overflow: string } } } }).document = {
        body: { style: { overflow: "" } },
      };
    }
  });

  it("does nothing when locked is false", () => {
    useBodyScrollLock(false);
    effectFn!();
    expect(document.body.style.overflow).toBe("");
  });

  it("locks and restores body scroll with ref counting", () => {
    // First lock
    useBodyScrollLock(true);
    effectFn!();
    const cleanup1 = effectCleanup as () => void;
    expect(document.body.style.overflow).toBe("hidden");

    // Nested second lock
    useBodyScrollLock(true);
    effectFn!();
    const cleanup2 = effectCleanup as () => void;
    expect(document.body.style.overflow).toBe("hidden");

    // Unlock one
    cleanup1();
    expect(document.body.style.overflow).toBe("hidden");

    // Unlock second
    cleanup2();
    expect(document.body.style.overflow).toBe("");
  });
});
