import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  isEditableElement,
  isDialogOpen,
  processShortcutKeyDown,
  SHORTCUTS,
  NAVIGATION_ROUTES,
  type ShortcutHandlerState,
} from "@/lib/use-keyboard-shortcuts";
import KeyboardShortcutsModal from "@/components/shell/KeyboardShortcutsModal";

describe("Keyboard Shortcuts: Logic & Definitions", () => {
  it("contains all expected navigation routes and hotkeys", () => {
    const chords = SHORTCUTS.map((s) => s.chord);
    expect(chords).toContain("g d");
    expect(chords).toContain("g t");
    expect(chords).toContain("g b");
    expect(chords).toContain("g c");
    expect(chords).toContain("g r");
    expect(chords).toContain("g g");
    expect(chords).toContain("g f");
    expect(chords).toContain("g s");
    expect(chords).toContain("?");
  });

  it("identifies editable elements correctly across all types", () => {
    expect(isEditableElement(null)).toBe(false);
    expect(isEditableElement(undefined as unknown as EventTarget)).toBe(false);
    expect(isEditableElement("string" as unknown as EventTarget)).toBe(false);

    expect(isEditableElement({ tagName: "input" } as unknown as EventTarget)).toBe(true);
    expect(isEditableElement({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableElement({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isEditableElement({ tagName: "SELECT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableElement({ tagName: "div", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isEditableElement({ tagName: "div", isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isEditableElement({ tagName: "button" } as unknown as EventTarget)).toBe(false);
  });

  function makeState(pendingChord: string | null = null) {
    const toggleHelp = vi.fn();
    const navigate = vi.fn();
    const preventDefault = vi.fn();
    const state: ShortcutHandlerState = {
      pendingChord,
      toggleHelp,
      navigate,
    };
    return { toggleHelp, navigate, preventDefault, state };
  }

  it("ignores keydown events when focus is inside an editable element", () => {
    const { state } = makeState("g");
    const target = { tagName: "INPUT" } as unknown as EventTarget;
    const next = processShortcutKeyDown(
      { key: "t", metaKey: false, ctrlKey: false, altKey: false, target, preventDefault: vi.fn() },
      state,
    );

    expect(next).toBe("g"); // Keeps existing state without navigating
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("processes '?' shortcut to toggle help", () => {
    const { toggleHelp, preventDefault, state } = makeState();
    const next = processShortcutKeyDown(
      { key: "?", metaKey: false, ctrlKey: false, altKey: false, target: null, preventDefault },
      state,
    );

    expect(toggleHelp).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(next).toBeNull();
  });

  it("ignores key events with modifier keys", () => {
    const { preventDefault, state } = makeState();

    expect(
      processShortcutKeyDown(
        { key: "g", metaKey: true, ctrlKey: false, altKey: false, target: null, preventDefault },
        state,
      ),
    ).toBeNull();

    expect(
      processShortcutKeyDown(
        { key: "g", metaKey: false, ctrlKey: true, altKey: false, target: null, preventDefault },
        state,
      ),
    ).toBeNull();

    expect(
      processShortcutKeyDown(
        { key: "g", metaKey: false, ctrlKey: false, altKey: true, target: null, preventDefault },
        state,
      ),
    ).toBeNull();
  });

  it("ignores OS auto-repeat events so holding 'g' never navigates", () => {
    const started = makeState();
    const chord = processShortcutKeyDown(
      { key: "g", metaKey: false, ctrlKey: false, altKey: false, target: null, preventDefault: vi.fn(), repeat: false },
      started.state,
    );
    expect(chord).toBe("g");

    const repeated = makeState(chord);
    const next = processShortcutKeyDown(
      { key: "g", metaKey: false, ctrlKey: false, altKey: false, target: null, preventDefault: vi.fn(), repeat: true },
      repeated.state,
    );
    expect(repeated.navigate).not.toHaveBeenCalled();
    expect(repeated.preventDefault).not.toHaveBeenCalled();
    expect(next).toBe("g"); // pending chord preserved, still waiting for a real second key
  });

  it("ignores OS auto-repeat of '?' so the help modal does not flicker", () => {
    const { toggleHelp, state } = makeState();
    const next = processShortcutKeyDown(
      { key: "?", metaKey: false, ctrlKey: false, altKey: false, target: null, preventDefault: vi.fn(), repeat: true },
      state,
    );
    expect(toggleHelp).not.toHaveBeenCalled();
    expect(next).toBeNull();
  });

  it("detects an open dialog so shortcuts can stay dormant behind modals", () => {
    expect(isDialogOpen({ querySelector: () => null })).toBe(false);
    expect(
      isDialogOpen({
        querySelector: (selector: string) =>
          selector === 'dialog[open], [role="dialog"]' ? {} : null,
      } as unknown as Parameters<typeof isDialogOpen>[0]),
    ).toBe(true);
  });

  it("starts chord sequence on 'g' key", () => {
    const { preventDefault, state } = makeState();
    const next = processShortcutKeyDown(
      { key: "g", metaKey: false, ctrlKey: false, altKey: false, target: null, preventDefault },
      state,
    );

    expect(next).toBe("g");
  });

  it("completes chord navigation when pending chord is 'g'", () => {
    for (const [key, path] of Object.entries(NAVIGATION_ROUTES)) {
      const { navigate, preventDefault, state } = makeState("g");
      const next = processShortcutKeyDown(
        { key, metaKey: false, ctrlKey: false, altKey: false, target: null, preventDefault },
        state,
      );

      expect(navigate).toHaveBeenCalledWith(path);
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(next).toBeNull();
    }
  });

  it("handles unknown key following 'g' by clearing pending chord without navigating", () => {
    const { navigate, preventDefault, state } = makeState("g");
    const next = processShortcutKeyDown(
      { key: "z", metaKey: false, ctrlKey: false, altKey: false, target: null, preventDefault },
      state,
    );

    expect(navigate).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(next).toBeNull();
  });

  it("returns null on other unrelated single keys", () => {
    const state: ShortcutHandlerState = {
      pendingChord: null,
      toggleHelp: vi.fn(),
      navigate: vi.fn(),
    };

    expect(
      processShortcutKeyDown(
        { key: "x", metaKey: false, ctrlKey: false, altKey: false, target: null, preventDefault: vi.fn() },
        state,
      ),
    ).toBeNull();
  });
});

describe("KeyboardShortcutsModal Component", () => {
  it("renders null when open is false", () => {
    const html = renderToStaticMarkup(
      createElement(KeyboardShortcutsModal, {
        open: false,
        onClose: () => {},
      }),
    );
    expect(html).toBe("");
  });

  it("renders modal with shortcuts list when open is true", () => {
    const html = renderToStaticMarkup(
      createElement(KeyboardShortcutsModal, {
        open: true,
        onClose: () => {},
      }),
    );
    expect(html).toContain("Keyboard shortcuts");
    expect(html).toContain("Navigation (Type sequentially)");
    expect(html).toContain("Go to Dashboard");
    expect(html).toContain("Go to Transactions");
    expect(html).toContain("Command Palette");
  });
});
