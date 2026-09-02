import { useCallback, useEffect, useRef, useState, type FocusEvent } from "react";

/**
 * Shared hook for popover / dropdown menus with keyboard dismiss and focus return.
 */
export function usePopoverMenu(initialOpen = false) {
  const [open, setOpen] = useState(initialOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  /**
   * Closes when focus leaves the menu's wrapping element (spread onto its
   * `relative inline-block` container). Mouse users get an outside-click
   * dismiss for free from the invisible `PopoverBackdrop`; without this,
   * keyboard users had no equivalent — tabbing past the last control just
   * left the popover open and orphaned behind whatever they tabbed onto.
   * Guarded on `open` so a plain Tab away from a *closed* trigger doesn't
   * call `close()` and yank focus back via its own `triggerRef.focus()`.
   */
  const onBlur = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      if (!open) return;
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        close();
      }
    },
    [open, close],
  );

  return { open, setOpen, close, toggle, triggerRef, onBlur };
}
