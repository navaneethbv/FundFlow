import { describe, it, expect, vi, beforeEach } from "vitest";

let currentEffect: (() => (() => void) | void) | null = null;
let mockHelpOpen = false;
let refCallCount = 0;
const chordRef = { current: null as string | null };
const timeoutRef = { current: null as unknown };
const mockRouterPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (fn: () => (() => void) | void) => {
      currentEffect = fn;
    },
    useRef: () => {
      refCallCount++;
      // First call is pendingChordRef, second is chordTimeoutRef
      return refCallCount % 2 === 1 ? chordRef : timeoutRef;
    },
    useState: (initial: boolean) => {
      mockHelpOpen = initial;
      const setState = (next: boolean | ((prev: boolean) => boolean)) => {
        mockHelpOpen = typeof next === "function" ? next(mockHelpOpen) : next;
      };
      return [mockHelpOpen, setState];
    },
  };
});

import { useKeyboardShortcuts } from "@/lib/use-keyboard-shortcuts";

function createMockKeyEvent(key: string): KeyboardEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: null,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

function createMockWindow() {
  let capturedHandler: ((e: KeyboardEvent) => void) | null = null;
  const addEventListener = vi.fn((event: string, handler: unknown) => {
    if (event === "keydown") {
      capturedHandler = handler as (e: KeyboardEvent) => void;
    }
  });
  const removeEventListener = vi.fn();
  return {
    getHandler: () => capturedHandler,
    windowObj: { addEventListener, removeEventListener },
  };
}

describe("useKeyboardShortcuts Hook Lifecycle", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    currentEffect = null;
    mockHelpOpen = false;
    refCallCount = 0;
    chordRef.current = null;
    timeoutRef.current = null;
    mockRouterPush.mockClear();
  });

  it("mounts keydown event listener and cleans up on unmount", () => {
    const { windowObj } = createMockWindow();

    vi.stubGlobal("window", windowObj);

    useKeyboardShortcuts();
    expect(currentEffect).not.toBeNull();

    const cleanup = currentEffect!();
    expect(windowObj.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));

    if (typeof cleanup === "function") {
      cleanup();
      expect(windowObj.removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
    }

    vi.unstubAllGlobals();
  });

  it("clears active chord timeout on unmount", () => {
    const mockWin = createMockWindow();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    vi.stubGlobal("window", mockWin.windowObj);

    useKeyboardShortcuts();
    const cleanup = currentEffect!();

    // Start chord 'g' to trigger timeout creation
    const handler = mockWin.getHandler();
    expect(handler).not.toBeNull();
    handler!(createMockKeyEvent("g"));

    if (typeof cleanup === "function") {
      cleanup();
      expect(clearTimeoutSpy).toHaveBeenCalled();
    }

    clearTimeoutSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("executes keydown handler inside effect: 'g' starts chord, 't' navigates, timeout clears chord", () => {
    const mockWin = createMockWindow();

    vi.stubGlobal("window", mockWin.windowObj);

    vi.useFakeTimers();

    useKeyboardShortcuts();
    currentEffect!();

    const handler = mockWin.getHandler();
    expect(handler).not.toBeNull();

    // 1. Press 'g'
    handler!(createMockKeyEvent("g"));
    expect(chordRef.current).toBe("g");

    // Advance timer by 1300ms to test timeout chord reset
    vi.advanceTimersByTime(1300);
    expect(chordRef.current).toBeNull();

    // 2. Press 'g' then 't'
    handler!(createMockKeyEvent("g"));
    expect(chordRef.current).toBe("g");

    handler!(createMockKeyEvent("t"));
    expect(mockRouterPush).toHaveBeenCalledWith("/transactions");

    // 3. Press '?' -> Toggles help
    handler!(createMockKeyEvent("?"));
    expect(mockHelpOpen).toBe(true);

    // 4. Press '?' again while help dialog is open -> Toggles help closed
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector === 'dialog[open], [role="dialog"]' ? {} : null,
    });
    handler!(createMockKeyEvent("?"));
    expect(mockHelpOpen).toBe(false);

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("swallows keys while a modal dialog is open and drops the pending chord", () => {
    const mockWin = createMockWindow();

    vi.stubGlobal("window", mockWin.windowObj);

    useKeyboardShortcuts();
    currentEffect!();

    const handler = mockWin.getHandler();
    expect(handler).not.toBeNull();

    // No document in node -> no dialog -> chord starts normally
    handler!(createMockKeyEvent("g"));
    expect(chordRef.current).toBe("g");

    // A dialog opens (any dialog[open] or [role="dialog"] present): the next
    // key must not navigate behind the modal and the half-typed chord clears.
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector === 'dialog[open], [role="dialog"]' ? {} : null,
    });
    handler!(createMockKeyEvent("t"));
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(chordRef.current).toBeNull();

    vi.unstubAllGlobals();
  });

  it("does not intercept '?' when typed into an editable input inside an open dialog", () => {
    const { windowObj, getHandler } = createMockWindow();
    vi.stubGlobal("window", windowObj);

    useKeyboardShortcuts();
    currentEffect!();

    const handler = getHandler();
    expect(handler).not.toBeNull();

    // A modal dialog is open
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector === 'dialog[open], [role="dialog"]' ? {} : null,
    });

    const preventDefault = vi.fn();
    const inputEvent = {
      key: "?",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      repeat: false,
      target: { tagName: "textarea" },
      preventDefault,
    } as unknown as KeyboardEvent;

    handler!(inputEvent);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(mockHelpOpen).toBe(false);

    vi.unstubAllGlobals();
  });
});
