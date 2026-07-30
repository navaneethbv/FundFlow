"use client";

import { Search } from "@/components/ui/icons";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/components/shell/command-palette-events";

export default function SearchButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
      aria-label="Search (Cmd+K)"
      title="Search (Cmd+K)"
      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-panel-border bg-panel-2 text-muted shadow-sm transition-colors duration-150 hover:border-accent/50 hover:text-foreground focus-visible:outline-2"
    >
      <Search aria-hidden className="h-3.5 w-3.5" />
    </button>
  );
}
