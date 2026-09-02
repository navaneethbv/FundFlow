"use client";

import { useKeyboardShortcuts } from "@/lib/use-keyboard-shortcuts";
import KeyboardShortcutsModal from "@/components/shell/KeyboardShortcutsModal";

export default function KeyboardShortcutsListener() {
  const { helpOpen, setHelpOpen } = useKeyboardShortcuts();

  return (
    <KeyboardShortcutsModal
      open={helpOpen}
      onClose={() => setHelpOpen(false)}
    />
  );
}
