"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface ShortcutDefinition {
  chord: string; // e.g. "g d" or "?"
  description: string;
  category: "Navigation" | "General";
}

export const SHORTCUTS: ShortcutDefinition[] = [
  { chord: "g d", description: "Go to Dashboard", category: "Navigation" },
  { chord: "g t", description: "Go to Transactions", category: "Navigation" },
  { chord: "g b", description: "Go to Budget", category: "Navigation" },
  { chord: "g c", description: "Go to Cash Flow", category: "Navigation" },
  { chord: "g r", description: "Go to Recurring", category: "Navigation" },
  { chord: "g g", description: "Go to Goals", category: "Navigation" },
  { chord: "g f", description: "Go to Forecasting", category: "Navigation" },
  { chord: "g s", description: "Go to Settings", category: "Navigation" },
  { chord: "Cmd + K", description: "Open Command Palette / Search", category: "General" },
  { chord: "?", description: "Show Keyboard Shortcuts", category: "General" },
];

export const NAVIGATION_ROUTES: Record<string, string> = {
  d: "/",
  t: "/transactions",
  b: "/budget",
  c: "/cash-flow",
  r: "/recurring",
  g: "/goals",
  f: "/forecasting",
  s: "/settings",
};

/**
 * Checks whether an event originated from an editable input/textarea element.
 */
export function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = (el.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(el.isContentEditable);
}

/**
 * Checks whether any modal dialog is currently open, so shortcuts must stay
 * dormant instead of navigating behind it. SSR-safe (no document -> false).
 */
export function isDialogOpen(doc?: Pick<Document, "querySelector">): boolean {
  const root = doc ?? (typeof document === "undefined" ? null : document);
  if (!root) return false;
  return Boolean(root.querySelector('dialog[open], [role="dialog"]'));
}

export interface ShortcutHandlerState {
  pendingChord: string | null;
  toggleHelp: () => void;
  navigate: (path: string) => void;
}

/**
 * Pure handler for shortcut keydown events.
 * Returns the next pending chord (e.g. "g" or null).
 */
export function processShortcutKeyDown(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "target" | "preventDefault"> & {
    repeat?: boolean;
  },
  state: ShortcutHandlerState,
): string | null {
  if (isEditableElement(e.target)) return state.pendingChord;
  if (e.metaKey || e.ctrlKey || e.altKey) return state.pendingChord;
  // OS key auto-repeat (holding a key) must not re-trigger chords or the help toggle
  if (e.repeat) return state.pendingChord;

  const key = e.key.toLowerCase();

  // Check for '?' key to open help
  if (e.key === "?") {
    e.preventDefault();
    state.toggleHelp();
    return null;
  }

  // If already in a chord sequence (e.g. pressed 'g' previously)
  if (state.pendingChord === "g") {
    const destination = NAVIGATION_ROUTES[key];
    if (destination) {
      e.preventDefault();
      state.navigate(destination);
    }
    return null;
  }

  // Start 'g' chord sequence
  if (key === "g") {
    return "g";
  }

  return null;
}

/**
 * Hook that listens for two-key chords (e.g. `g` then `d`) and `?` for help.
 */
export function useKeyboardShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const pendingChordRef = useRef<string | null>(null);
  const chordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isDialogOpen()) {
        pendingChordRef.current = null;
        if (!isEditableElement(e.target) && !e.repeat && e.key === "?") {
          e.preventDefault();
          setHelpOpen((cur) => !cur);
        }
        return;
      }

      const nextChord = processShortcutKeyDown(e, {
        pendingChord: pendingChordRef.current,
        toggleHelp: () => setHelpOpen((cur) => !cur),
        navigate: (path) => router.push(path),
      });

      pendingChordRef.current = nextChord;

      if (chordTimeoutRef.current) clearTimeout(chordTimeoutRef.current);
      if (nextChord === "g") {
        chordTimeoutRef.current = setTimeout(() => {
          pendingChordRef.current = null;
        }, 1200);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (chordTimeoutRef.current) clearTimeout(chordTimeoutRef.current);
    };
  }, [router]);

  return {
    helpOpen,
    setHelpOpen,
  };
}
