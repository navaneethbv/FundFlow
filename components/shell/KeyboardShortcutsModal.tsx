"use client";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { SHORTCUTS } from "@/lib/use-keyboard-shortcuts";

export default function KeyboardShortcutsModal({
  open,
  onClose,
}: Readonly<{
  open: boolean;
  onClose: () => void;
}>) {
  const navigationShortcuts = SHORTCUTS.filter((s) => s.category === "Navigation");
  const generalShortcuts = SHORTCUTS.filter((s) => s.category === "General");

  return (
    <Modal
      open={open}
      onClose={onClose}
      titleId="keyboard-shortcuts-title"
      ariaLabel="Keyboard shortcuts"
    >
      <div className="space-y-5 text-sm">
        <div className="flex items-center justify-between border-b border-panel-border/50 pb-3">
          <h2 id="keyboard-shortcuts-title" className="text-base font-bold text-foreground">
            Keyboard shortcuts
          </h2>
          <Badge tone="neutral">Power-user</Badge>
        </div>

        <div>
          <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted">
            Navigation (Type sequentially)
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {navigationShortcuts.map((s) => (
              <div
                key={s.chord}
                className="flex items-center justify-between rounded-field bg-panel-2 px-3 py-2 text-xs"
              >
                <span className="text-foreground">{s.description}</span>
                <span className="flex items-center gap-1 font-mono">
                  {s.chord.split(" ").map((k) => (
                    <kbd
                      key={k}
                      className="rounded border border-panel-border bg-panel px-1.5 py-0.5 font-bold uppercase text-foreground shadow-sm"
                    >
                      {k}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted">
            General
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {generalShortcuts.map((s) => (
              <div
                key={s.chord}
                className="flex items-center justify-between rounded-field bg-panel-2 px-3 py-2 text-xs"
              >
                <span className="text-foreground">{s.description}</span>
                <span className="flex items-center gap-1 font-mono">
                  {s.chord.split(" ").map((k) => (
                    <kbd
                      key={k}
                      className="rounded border border-panel-border bg-panel px-1.5 py-0.5 font-bold uppercase text-foreground shadow-sm"
                    >
                      {k}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
