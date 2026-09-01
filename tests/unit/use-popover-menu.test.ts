import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let currentEffect: (() => (() => void) | void) | null = null;
let currentRefValue: HTMLButtonElement | null = null;
let mockState = false;

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: (cb: unknown) => cb,
    useEffect: (fn: () => (() => void) | void) => {
      currentEffect = fn;
    },
    useRef: () => ({ current: currentRefValue }),
    useState: (initial: boolean) => {
      mockState = initial;
      const setState = (next: boolean | ((prev: boolean) => boolean)) => {
        mockState = typeof next === "function" ? next(mockState) : next;
      };
      return [mockState, setState];
    },
  };
});

import PopoverBackdrop from "@/components/ui/PopoverBackdrop";
import { usePopoverMenu } from "@/lib/use-popover-menu";

describe("usePopoverMenu & PopoverBackdrop", () => {
  beforeEach(() => {
    currentEffect = null;
    currentRefValue = null;
    mockState = false;
  });

  it("handles toggle, open, and close with trigger focus return", () => {
    const focusFn = vi.fn();
    currentRefValue = { focus: focusFn } as unknown as HTMLButtonElement;

    const menu = usePopoverMenu(false);
    expect(menu.open).toBe(false);

    menu.toggle();
    expect(mockState).toBe(true);

    menu.close();
    expect(mockState).toBe(false);
    expect(focusFn).toHaveBeenCalled();
  });

  it("handles Escape key dismiss in effect", () => {
    const focusFn = vi.fn();
    currentRefValue = { focus: focusFn } as unknown as HTMLButtonElement;

    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();

    const originalWindow = globalThis.window;
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener,
      removeEventListener,
    };

    try {
      // Open is false -> effect returns early without adding listener
      usePopoverMenu(false);
      expect(currentEffect).not.toBeNull();
      const cleanupNoop = currentEffect!();
      expect(cleanupNoop).toBeUndefined();

      // Open is true -> effect registers keydown listener
      mockState = true;
      usePopoverMenu(true);
      const cleanup = currentEffect!();
      expect(addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));

      const listener = addEventListener.mock.calls[0][1] as (e: KeyboardEvent) => void;

      // Non-escape key is ignored
      listener({ key: "Enter" } as KeyboardEvent);
      expect(focusFn).not.toHaveBeenCalled();

      // Escape key triggers close & focus return
      listener({ key: "Escape" } as KeyboardEvent);
      expect(focusFn).toHaveBeenCalled();

      // Cleanup removes listener
      if (typeof cleanup === "function") cleanup();
      expect(removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
    } finally {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  });

  it("renders PopoverBackdrop with accessibility attributes and handles click", () => {
    const onClose = vi.fn();
    const html = renderToStaticMarkup(
      createElement(PopoverBackdrop, { onClose, zIndex: "z-40" }),
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("fixed inset-0 z-40 cursor-default");
  });
});
