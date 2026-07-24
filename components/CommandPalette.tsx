"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "@/components/ui/icons";

/**
 * Command palette (8.3): Cmd+K / Ctrl+K jump-to-anywhere. A static command
 * list keeps it CSP-safe and dependency-free — filtering and keyboard
 * navigation are plain React state. Mounted once in AppShell so it works on
 * every signed-in page.
 */
interface Command {
  label: string;
  href: string;
  hint: string;
}

const COMMANDS: Command[] = [
  { label: "Dashboard", href: "/dashboard", hint: "Monitor view" },
  { label: "Plan view", href: "/dashboard?view=plan", hint: "Budgets, bills, debt" },
  { label: "Wealth view", href: "/dashboard?view=wealth", hint: "Net worth & breakdowns" },
  { label: "Transactions", href: "/transactions", hint: "Ledger" },
  { label: "Goals", href: "/goals", hint: "Savings goals" },
  { label: "Notifications", href: "/notifications", hint: "Alerts & digests" },
  { label: "Settings", href: "/settings", hint: "Control center" },
  { label: "Budgets", href: "/settings#budgets", hint: "Monthly limits" },
  { label: "Review", href: "/review", hint: "Monthly review" },
  { label: "Export CSV", href: "/api/export/csv", hint: "Privacy-safe download" },
  { label: "Tax CSV", href: "/api/export/csv?scope=tax", hint: "Tax-tagged download" },
];

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return COMMANDS;
    return COMMANDS.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        command.hint.toLowerCase().includes(needle),
    );
  }, [query]);

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
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={close}
      />
      <div
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        className="relative w-full max-w-lg rounded-card border border-panel-border bg-panel shadow-card"
      >
        <div className="flex items-center gap-2 border-b border-panel-border px-4 py-3">
          <Search aria-hidden className="h-4 w-4 text-muted" />
          <input
            ref={inputRef}
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
        <ul className="max-h-72 overflow-y-auto p-2" role="listbox" aria-label="Commands">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No matches.</li>
          ) : (
            matches.map((command, index) => (
              <li key={command.href} role="option" aria-selected={index === selected}>
                <button
                  type="button"
                  onClick={() => activate(command)}
                  onMouseEnter={() => setSelected(index)}
                  className={`flex w-full items-center justify-between gap-3 rounded-field px-3 py-2 text-left text-sm focus-visible:outline-2 ${
                    index === selected ? "bg-panel-hover" : "hover:bg-panel-hover"
                  }`}
                >
                  <span className="font-semibold">{command.label}</span>
                  <span className="truncate text-xs text-muted">{command.hint}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
