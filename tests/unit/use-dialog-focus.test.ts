import { describe, it, expect, vi, beforeEach } from "vitest";

let effectFn: (() => void) | null = null;

vi.mock("react", () => ({
  useCallback: (cb: unknown) => cb,
  useEffect: (fn: () => void) => {
    effectFn = fn;
  },
}));

import { useDialogFocus } from "@/lib/use-dialog-focus";

describe("useDialogFocus", () => {
  beforeEach(() => {
    effectFn = null;
  });

  it("handles useEffect focus when open is true and false", () => {
    const focusFn = vi.fn();
    const fakeDialog = {
      querySelector: vi.fn().mockReturnValue({ focus: focusFn }),
    } as unknown as HTMLDialogElement;

    // open = false
    useDialogFocus({ current: fakeDialog }, false, vi.fn());
    expect(effectFn).not.toBeNull();
    effectFn!();
    expect(fakeDialog.querySelector).not.toHaveBeenCalled();

    // open = true
    useDialogFocus({ current: fakeDialog }, true, vi.fn());
    effectFn!();
    expect(fakeDialog.querySelector).toHaveBeenCalled();
    expect(focusFn).toHaveBeenCalled();
  });

  it("handles Escape key", () => {
    const onEscape = vi.fn();
    const onKeyDown = useDialogFocus({ current: null }, true, onEscape);
    const event = {
      key: "Escape",
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLDialogElement>;

    onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onEscape).toHaveBeenCalled();
  });

  it("ignores non-Tab keys", () => {
    const onEscape = vi.fn();
    const onKeyDown = useDialogFocus({ current: null }, true, onEscape);
    const event = {
      key: "Enter",
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLDialogElement>;

    onKeyDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("handles Tab when dialog has no controls or is null", () => {
    const onEscape = vi.fn();
    const onKeyDownNull = useDialogFocus({ current: null }, true, onEscape);
    const event1 = {
      key: "Tab",
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLDialogElement>;
    onKeyDownNull(event1);
    expect(event1.preventDefault).not.toHaveBeenCalled();

    const fakeDialogEmpty = {
      querySelectorAll: vi.fn().mockReturnValue([]),
    } as unknown as HTMLDialogElement;
    const onKeyDownEmpty = useDialogFocus({ current: fakeDialogEmpty }, true, onEscape);
    onKeyDownEmpty(event1);
    expect(event1.preventDefault).not.toHaveBeenCalled();
  });

  it("handles Tab and Shift+Tab wrapping around focusable controls", () => {
    const onEscape = vi.fn();
    const first = { focus: vi.fn() } as unknown as HTMLElement;
    const last = { focus: vi.fn() } as unknown as HTMLElement;
    const fakeDialog = {
      querySelectorAll: vi.fn().mockReturnValue([first, last]),
    } as unknown as HTMLDialogElement;

    const onKeyDown = useDialogFocus({ current: fakeDialog }, true, onEscape);

    // Shift+Tab from first element -> wraps to last
    const origActive = globalThis.document?.activeElement;
    (globalThis as unknown as { document: { activeElement: HTMLElement } }).document = {
      activeElement: first,
    };

    const shiftTab = {
      key: "Tab",
      shiftKey: true,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLDialogElement>;
    onKeyDown(shiftTab);
    expect(shiftTab.preventDefault).toHaveBeenCalled();
    expect(last.focus).toHaveBeenCalled();

    // Tab from last element -> wraps to first
    (globalThis as unknown as { document: { activeElement: HTMLElement } }).document = {
      activeElement: last,
    };

    const forwardTab = {
      key: "Tab",
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLDialogElement>;
    onKeyDown(forwardTab);
    expect(forwardTab.preventDefault).toHaveBeenCalled();
    expect(first.focus).toHaveBeenCalled();

    // Tab on middle element (neither first nor last) -> default behavior
    const middle = { focus: vi.fn() } as unknown as HTMLElement;
    (globalThis as unknown as { document: { activeElement: HTMLElement } }).document = {
      activeElement: middle,
    };
    const middleTab = {
      key: "Tab",
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLDialogElement>;
    onKeyDown(middleTab);
    expect(middleTab.preventDefault).not.toHaveBeenCalled();

    if (origActive !== undefined) {
      (globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement =
        origActive;
    }
  });
});
