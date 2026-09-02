"use client";

import { useRef } from "react";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { cn } from "@/lib/cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  titleId?: string;
  ariaLabel?: string;
  className?: string;
  placement?: "center" | "sheet";
  children?: React.ReactNode;
}

/**
 * Accessible modal dialog primitive enforcing the dialog focus discipline:
 * native `<dialog open aria-modal="true">` with focus trapping, Tab cycling,
 * Escape key dismissing, and focus restoration to the trigger upon close.
 *
 * Supports `placement="sheet"` for mobile-first bottom-sheet drawers that
 * transition to centered modals on desktop viewports.
 */
export default function Modal({
  open,
  onClose,
  titleId,
  ariaLabel,
  className,
  placement = "center",
  children,
}: Readonly<ModalProps>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const handleDialogKeyDown = useDialogFocus(dialogRef, open, onClose);

  if (!open) return null;

  const isSheet = placement === "sheet";

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center bg-black/60",
        isSheet
          ? "items-end p-0 sm:items-center sm:p-4"
          : "items-center p-4",
      )}
    >
      {/*
        Backdrop click-to-close as a real native <button>, not a div with a
        click handler — keyboard-operable by default, no manual onKeyDown
        needed. It's a sibling of <dialog>, not an ancestor, and stacks
        beneath it (both position!=static with z-index:auto stack in DOM
        order, and <dialog> already carries `relative` below), so it only
        ever catches clicks that land outside the dialog box; no dialog
        click can bubble through it. It never becomes an extra keyboard stop
        either: useDialogFocus already intercepts every Tab/Shift+Tab at the
        dialog's first/last control and redirects back inside, so focus can
        never actually reach this button while the dialog is open — Escape
        (handled there too) remains the real keyboard path to close.
      */}
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default border-0 bg-transparent p-0"
      />
      <dialog
        open
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={!titleId ? ariaLabel : undefined}
        onKeyDown={handleDialogKeyDown}
        className={cn(
          // Height is capped and scrolled here, not left to each caller: a
          // sheet is pinned to the bottom edge, so content taller than the
          // viewport overflows off the *top* of a `fixed inset-0` container
          // that does not scroll, putting the first fields out of reach.
          // MobileNavigation's hand-rolled sheet caps the same way. Callers
          // that pass their own max-h/overflow still win via twMerge.
          "relative m-0 max-h-[90vh] w-full max-w-md overflow-y-auto border border-panel-border bg-panel p-5 shadow-float sm:p-6",
          isSheet
            ? "rounded-t-card sm:rounded-card"
            : "rounded-card",
          className,
        )}
      >
        {children}
      </dialog>
    </div>
  );
}
