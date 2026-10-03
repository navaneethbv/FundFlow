"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";

export default function UndoToast({
  message,
  onUndo,
  duration = 8000,
}: Readonly<{
  message: string;
  onUndo: () => Promise<void>;
  duration?: number;
}>) {
  const [visible, setVisible] = useState(true);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), duration);
    return () => window.clearTimeout(timeout);
  }, [duration]);

  if (!visible) return null;
  async function undo() {
    setWorking(true);
    try {
      await onUndo();
      setStatus("Undone");
      window.setTimeout(() => setVisible(false), 1000);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "This transaction changed; undo was not applied.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-[70] flex w-[min(92vw,30rem)] -translate-x-1/2 items-center gap-3 rounded-card border border-panel-border bg-panel px-4 py-3 shadow-float" role="status" aria-live="polite">
      <span className="min-w-0 flex-1 text-sm">{status ?? message}</span>
      {!status && <Button type="button" size="sm" variant="secondary" onClick={() => void undo()} loading={working}>Undo</Button>}
      {status && <Button type="button" size="sm" variant="ghost" onClick={() => setVisible(false)}>Dismiss</Button>}
    </div>
  );
}
