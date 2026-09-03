"use client";

import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import type { ReactNode } from "react";

export interface ReviewCardProps {
  title: string;
  eyebrow: string;
  children: ReactNode;
  error?: string | null;
}

export function ReviewCard({ title, eyebrow, children, error }: ReviewCardProps) {
  return (
    <Panel title={title} eyebrow={eyebrow}>
      <div className="space-y-2 text-sm">{children}</div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Panel>
  );
}

export interface ReviewItemActionProps {
  id: string;
  busyId: string | null;
  confirmLabel: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function ReviewItemActions({
  id,
  busyId,
  confirmLabel,
  onConfirm,
  onDismiss,
}: ReviewItemActionProps) {
  const isBusy = busyId === id;
  return (
    <span className="flex gap-2">
      <Button size="sm" onClick={onConfirm} loading={isBusy}>
        {confirmLabel}
      </Button>
      <Button size="sm" variant="secondary" onClick={onDismiss} loading={isBusy}>
        Dismiss
      </Button>
    </span>
  );
}
