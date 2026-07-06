"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

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

export default function ThemeToggle() {
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

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(nextTheme);
        setTheme(nextTheme);
      }}
      aria-label={`Switch to ${nextTheme} mode`}
      className="inline-flex items-center gap-2 rounded-full border border-[var(--surface-border)] bg-black/[0.04] px-3 py-1.5 text-sm font-bold text-[var(--muted)] transition-all duration-150 hover:border-[var(--accent)] hover:text-[var(--foreground)] focus-visible:outline-2 dark:bg-white/[0.06]"
    >
      <span className="relative h-4 w-8 rounded-full bg-black/10 dark:bg-white/15">
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-[var(--foreground)] transition-transform duration-150 ${
            theme === "dark" ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
      <span>{theme === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}
