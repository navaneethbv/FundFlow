"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "@/components/ui/icons";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/components/shell/command-palette-events";
import { useDialogFocus } from "@/lib/use-dialog-focus";

/**
 * Command palette (8.3): Cmd+K / Ctrl+K jump-to-anywhere. The command list is
 * passed in as a prop (built by AppShell from the enabled nav items) so it
 * stays in sync with the sidebar automatically: filtering and keyboard
 * navigation are plain React state, no dependency. Mounted once in AppShell
 * so it works on every signed-in page.
 */
interface Command {
  label: string;
  href: string;
  hint: string;
}

export default function CommandPalette({ items }: Readonly<{ items: Command[] }>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        command.hint.toLowerCase().includes(needle),
    );
  }, [items, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelected(0);
  }, []);

  const activate = useCallback(
    (command: Command | undefined) => {
      if (!command) return;
      close();
      // API downloads must be full navigations, not client transitions.
      if (command.href.startsWith("/api/")) {
        window.location.assign(command.href);
      } else {
        router.push(command.href);
      }
    },
    [close, router],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        setQuery("");
        setSelected(0);
      }
    }
    function onOpenRequest() {
      setOpen(true);
      setQuery("");
      setSelected(0);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
    };
  }, []);

  const handleDialogKeyDown = useDialogFocus(dialogRef, open, close);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh]">
      {/* Click-outside-to-close as a real button, so it is not a bare click
          handler on a non-interactive element. Kept out of the tab order:
          Escape (wired globally above) is the keyboard affordance. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close command palette"
        className="absolute inset-0 h-full w-full cursor-default bg-black/50"
        onClick={close}
      />
      <dialog
        open
        ref={dialogRef}
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleDialogKeyDown}
        className="relative m-0 w-full max-w-lg rounded-card border border-panel-border bg-panel shadow-card"
      >
        <div className="flex items-center gap-2 border-b border-panel-border px-4 py-3">
          <Search aria-hidden className="h-4 w-4 text-muted" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={matches[selected] ? `command-opt-${selected}` : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((current) => Math.min(current + 1, matches.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                activate(matches[selected]);
              }
            }}
            placeholder="Jump to…"
            aria-label="Search commands"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <kbd className="rounded-field border border-panel-border bg-panel-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
            esc
          </kbd>
        </div>
        <ul id="command-palette-list" className="max-h-72 overflow-y-auto p-2" role="listbox" aria-label="Commands">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No matches.</li>
          ) : (
            matches.map((command, index) => (
              <li
                key={command.href}
                id={`command-opt-${index}`}
                role="option"
                aria-selected={index === selected}
                onClick={() => activate(command)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activate(command);
                  }
                }}
                onMouseEnter={() => setSelected(index)}
                className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-field px-3 py-2 text-left text-sm transition-colors ${
                  index === selected ? "bg-panel-hover" : "hover:bg-panel-hover"
                }`}
              >
                <span className="font-semibold">{command.label}</span>
                <span className="truncate text-xs text-muted">{command.hint}</span>
              </li>
            ))
          )}
        </ul>
      </dialog>
    </div>
  );
}
