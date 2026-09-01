import { useCallback, useEffect, type RefObject } from "react";

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
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
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
      if (!controls || controls.length === 0) return;
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
