"use client";

import { cn } from "@/lib/cn";
import { Check } from "@/components/ui/icons";
import { palettesFor, type ThemeMode } from "@/lib/themes";

/**
 * One swatch card per palette: a miniature of the page (background, a
 * raised panel, a gradient button, and an accent line of text) painted with
 * that palette's own colours, so the choice is visible before it is made.
 * A native radio group underneath keeps it keyboard- and reader-friendly.
 */
export default function PalettePicker({
  mode,
  value,
  onChange,
  disabled = false,
}: Readonly<{
  mode: ThemeMode;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}>) {
  const name = `palette-${mode}`;
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold">
        {mode === "light" ? "Light mode palette" : "Dark mode palette"}
      </legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {palettesFor(mode).map((palette) => {
          const selected = palette.id === value;
          const text = mode === "light" ? "#222220" : "#f2f1ee";
          return (
            <label
              key={palette.id}
              className={cn(
                "group relative block cursor-pointer rounded-card border p-1.5 transition-all duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                selected
                  ? "border-accent shadow-pop"
                  : "border-panel-border hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-float",
                disabled && "pointer-events-none opacity-60",
              )}
            >
              <input
                type="radio"
                name={name}
                value={palette.id}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(palette.id)}
                className="sr-only"
              />
              <span
                aria-hidden
                className="block overflow-hidden rounded-field p-2"
                style={{ background: palette.background }}
              >
                <span
                  className="block rounded-md p-2 shadow-sm"
                  style={{ background: palette.panel, border: `1px solid ${palette.border}` }}
                >
                  <span className="mb-1.5 block h-1.5 w-10 rounded-full" style={{ background: text, opacity: 0.8 }} />
                  <span className="mb-2 block h-1 w-14 rounded-full" style={{ background: palette.accent }} />
                  <span
                    className="block h-3.5 w-12 rounded-full"
                    style={{ background: `linear-gradient(135deg, ${palette.accentStrong}, ${palette.accentStrong2})` }}
                  />
                </span>
              </span>
              <span className="flex items-start justify-between gap-1 px-1 pb-0.5 pt-2">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight">{palette.name}</span>
                  <span className="block text-xs leading-snug text-muted">{palette.mood}</span>
                </span>
                {selected && (
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <Check aria-hidden className="h-3 w-3" />
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
