"use client";
import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import Button from "@/components/ui/Button";

export default function DetailPane({ open, onClose, titleId, children }: Readonly<{
  open: boolean; onClose: () => void; titleId: string; children: ReactNode;
}>) {
  const panel = useRef<HTMLDialogElement>(null);
  const onKeyDown = useDialogFocus(panel, open, onClose);
  useBodyScrollLock(open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <button type="button" tabIndex={-1} aria-label="Close transaction details" onClick={onClose} className="absolute inset-0 cursor-default" />
      <dialog open ref={panel} aria-modal="true" tabIndex={-1} data-transaction-detail aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="relative m-0 h-dvh max-h-dvh w-full max-w-[460px] overflow-y-auto border-l border-panel-border bg-background p-5 text-foreground shadow-float sm:p-6">
        <div className="mb-4 flex justify-end"><Button variant="ghost" size="sm" onClick={onClose}>Close details</Button></div>
        {children}
      </dialog>
    </div>, document.body,
  );
}
