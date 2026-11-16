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
      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-panel-hover hover:text-foreground focus-visible:outline-2"
    >
      <Search aria-hidden className="h-4 w-4" />
    </button>
  );
}
