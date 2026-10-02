"use client";

import { useEffect, type ReactNode } from "react";
import { isDialogOpen, isEditableElement } from "@/lib/use-keyboard-shortcuts";

function visible<T extends HTMLElement>(elements: T[]): T | null {
  return elements.find((element) => element.getClientRects().length > 0) ?? elements[0] ?? null;
}

function rows(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-ledger-row]"));
}

function focusRow(root: HTMLElement, index: number): void {
  const list = rows(root);
  const target = list[Math.max(0, Math.min(index, list.length - 1))];
  target?.focus();
}

function currentRow(root: HTMLElement, target: EventTarget | null): HTMLElement | null {
  const element = target instanceof HTMLElement ? target : null;
  return element?.closest<HTMLElement>("[data-ledger-row]") ?? rows(root)[0] ?? null;
}

function openEditor(row: HTMLElement, focusSelector?: string): void {
  visible(Array.from(row.querySelectorAll<HTMLButtonElement>("[data-transaction-detail-trigger]")))?.click();
  if (!focusSelector) return;
  window.setTimeout(() => {
    const control = visible(Array.from(row.querySelectorAll<HTMLElement>(focusSelector)));
    control?.focus();
  }, 0);
}

/** Keyboard-only movement and row actions for the transaction ledger. */
export default function LedgerKeyboardNavigation({
  children,
  enabled,
}: Readonly<{ children: ReactNode; enabled: boolean }>) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.querySelector<HTMLElement>("[data-ledger-keyboard-root]");
    if (!root) return;
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableElement(event.target)) return;
      const row = currentRow(root!, event.target);
      if (event.key === "Escape") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("fundflow:transaction-detail-close"));
        return;
      }
      if (!row || (isDialogOpen() && event.key !== "Escape")) return;
      const list = rows(root!);
      const index = list.indexOf(row);
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        focusRow(root!, index + 1);
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        focusRow(root!, index - 1);
        return;
      }
      if (event.key === "Enter" || event.key.toLowerCase() === "e") {
        event.preventDefault();
        openEditor(row);
        return;
      }
      if (event.key.toLowerCase() === "x") {
        const checkbox = visible(Array.from(row.querySelectorAll<HTMLInputElement>("input[data-bulk-select]")));
        if (checkbox) {
          event.preventDefault();
          checkbox.click();
        }
        return;
      }
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        openEditor(row, '[id^="override-display-"]');
        return;
      }
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        openEditor(row, '[id^="tags-"]');
      }
    }
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  return <div data-ledger-keyboard-root={enabled ? "true" : undefined}>{children}</div>;
}
