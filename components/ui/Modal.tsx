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
  children: React.ReactNode;
}

/**
 * Accessible modal dialog primitive enforcing the dialog focus discipline:
 * native `<dialog open aria-modal="true">` with focus trapping, Tab cycling,
 * Escape key dismissing, and focus restoration to the trigger upon close.
 */
export default function Modal({
  open,
  onClose,
  titleId,
  ariaLabel,
  className,
  children,
}: Readonly<ModalProps>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const handleDialogKeyDown = useDialogFocus(dialogRef, open, onClose);

  if (!open) return null;

  return (
    // Backdrop click is a mouse/touch-only dismiss affordance layered on top
    // of the real keyboard path (Escape, handled by useDialogFocus below);
    // it deliberately stays outside the tab order rather than adding an
    // extra stop a keyboard user would have to pass through to reach the
    // dialog's own controls.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog
        open
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={!titleId ? ariaLabel : undefined}
        onKeyDown={handleDialogKeyDown}
        className={cn(
          "relative m-0 w-full max-w-md rounded-card border border-panel-border bg-panel p-5 shadow-float sm:p-6",
          className,
        )}
      >
        {children}
      </dialog>
    </div>
  );
}
