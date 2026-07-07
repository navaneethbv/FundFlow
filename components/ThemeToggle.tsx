"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Moon, Sun } from "@/components/ui/icons";

type Theme = "light" | "dark";
type ThemeToggleVariant = "default" | "switch";

const STORAGE_KEY = "fundflow-theme";

function systemTheme(): Theme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}

export default function ThemeToggle({
  variant = "default",
}: {
  variant?: ThemeToggleVariant;
}) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      const stored = localStorage.getItem(STORAGE_KEY);
      const nextTheme = stored === "light" || stored === "dark" ? stored : systemTheme();
      document.documentElement.dataset.theme = nextTheme;
      setTheme(nextTheme);
    });
    return () => {
      active = false;
    };
  }, []);

  const nextTheme = theme === "dark" ? "light" : "dark";

  const toggleTheme = () => {
    applyTheme(nextTheme);
    setTheme(nextTheme);
  };

  if (variant === "switch") {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={`Switch to ${nextTheme} mode`}
        className="group inline-flex items-center gap-2 rounded-full border border-panel-border bg-panel-2 px-2 py-1 text-muted shadow-sm transition-colors duration-150 hover:border-accent/50 hover:text-foreground focus-visible:outline-2"
      >
        <Sun aria-hidden className="h-3.5 w-3.5" />
        <span className="relative h-4 w-8 rounded-full bg-black/10 dark:bg-white/15">
          <span
            className={cn(
              "absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-accent-strong shadow-pop transition-transform duration-150",
              theme === "dark" ? "translate-x-4" : "translate-x-0",
            )}
          />
        </span>
        <Moon aria-hidden className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} mode`}
      className="inline-flex items-center gap-2 rounded-full border border-[var(--surface-border)] bg-black/[0.04] px-3 py-1.5 text-sm font-bold text-[var(--muted)] transition-all duration-150 hover:border-[var(--accent)] hover:text-[var(--foreground)] focus-visible:outline-2 dark:bg-white/[0.06]"
    >
      <span className="relative h-4 w-8 rounded-full bg-black/10 dark:bg-white/15">
        <span
          className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-[var(--foreground)] transition-transform duration-150 ${
            theme === "dark" ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
      <span>{theme === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}
