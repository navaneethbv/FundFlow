"use client";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
const query = "(min-width: 1024px)";
function subscribe(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
function snapshot() {
  return window.matchMedia(query).matches;
}
export default function DetailPane({
  open,
  onClose,
  titleId,
  children,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  titleId: string;
  children: ReactNode;
}>) {
  const desktop = useSyncExternalStore(subscribe, snapshot, () => false);
  const panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open || !desktop) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      previous?.focus();
    };
  }, [open, desktop]);
  if (!open) return null;
  if (!desktop)
    return (
      <Modal open onClose={onClose} titleId={titleId} placement="sheet">
        <Button variant="ghost" size="sm" className="mb-3" onClick={onClose}>
          Close details
        </Button>
        {children}
      </Modal>
    );
  return createPortal(
    <dialog
      open
      ref={panel}
      aria-modal="false"
      tabIndex={-1}
      data-transaction-detail
      aria-labelledby={titleId}
      className="fixed bottom-0 left-auto right-0 top-0 z-40 m-0 h-dvh w-[26rem] overflow-y-auto border-l border-panel-border bg-panel p-6 shadow-float"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <Button variant="ghost" size="sm" className="mb-3" onClick={onClose}>
        Close details
      </Button>
      {children}
    </dialog>,
    document.body,
  );
}
