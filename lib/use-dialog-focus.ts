import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Every control a dialog can move focus to. Kept exported and covered by
 * tests because a dialog whose content grows a link or textarea must trap
 * the same way as one holding only form controls — a missed selector means
 * Tab leaks to the page behind the modal.
 */
export const FOCUSABLE = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function useDialogFocus(
  dialogRef: RefObject<HTMLDialogElement | null>,
  open: boolean,
  onEscape: () => void,
) {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // A message-only dialog has no tabbable controls; focus the dialog
    // itself (tabIndex={-1} in Modal) so keyboard context stays inside.
    const firstControl = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (firstControl) firstControl.focus();
    else dialogRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus();
    };
  }, [dialogRef, open]);

  return useCallback(
    (event: React.KeyboardEvent<HTMLDialogElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      // No tabbable controls: hold focus on the dialog itself rather than
      // leaking Tab to the page behind the overlay.
      if (!controls || controls.length === 0) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [dialogRef, onEscape],
  );
}
