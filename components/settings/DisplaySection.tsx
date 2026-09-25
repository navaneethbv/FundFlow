"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Field from "@/components/ui/Field";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import ThemeToggle from "@/components/ThemeToggle";
import PalettePicker from "@/components/settings/PalettePicker";
import { applyPalette } from "@/lib/theme-client";
import type { DisplayPrefs } from "@/components/settings/settings-nav";

/**
 * Theme, density, default privacy blur, and reduced motion. The quick
 * ThemeToggle in the top bar stays — this is the persisted default it and
 * every fresh session start from, not a replacement for it.
 */
export default function DisplaySection({ initialPrefs }: Readonly<{ initialPrefs: DisplayPrefs }>) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initialPrefs);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  function applyThemePreference(theme: DisplayPrefs["theme"]) {
    const resolved =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    document.documentElement.dataset.theme = resolved;
    try {
      if (theme === "system") localStorage.removeItem("fundflow-theme");
      else localStorage.setItem("fundflow-theme", theme);
    } catch {
      // Applies for this page even when storage is blocked.
    }
  }

  function choosePalette(mode: "light" | "dark", id: string) {
    // Paint first, then persist: the preview is the point of the picker.
    applyPalette(mode, id);
    void update(mode === "light" ? { lightPalette: id } : { darkPalette: id });
  }

  async function update(patch: Partial<DisplayPrefs>) {
    setBusy(true);
    setStatus(null);
    let previous: DisplayPrefs = prefs;
    setPrefs((current) => {
      previous = current;
      return { ...current, ...patch };
    });
    try {
      const response = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "display", prefs: patch }),
      });
      if (response.ok) {
        setStatus("Saved.");
        router.refresh();
      } else {
        setPrefs(previous); // roll back to the state just before this patch
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Display" eyebrow="Appearance">
      <div className="space-y-6">
        <div className="space-y-5">
          <p className="text-sm text-muted">
            Pick a palette for each mode. Light and dark keep their own choice, and it follows you to
            every device you sign in on.
          </p>
          <PalettePicker
            mode="light"
            value={prefs.lightPalette}
            onChange={(id) => choosePalette("light", id)}
            disabled={busy}
          />
          <PalettePicker
            mode="dark"
            value={prefs.darkPalette}
            onChange={(id) => choosePalette("dark", id)}
            disabled={busy}
          />
        </div>
        <div className="space-y-3 border-t border-panel-border pt-5">
        <Field label="Theme" htmlFor="display-theme">
          <div className="flex items-center gap-3">
            <Select
              id="display-theme"
              value={prefs.theme}
              onChange={(e) => {
                const theme = e.target.value as DisplayPrefs["theme"];
                applyThemePreference(theme);
                void update({ theme });
              }}
              disabled={busy}
              className="max-w-40"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
            <ThemeToggle />
          </div>
        </Field>
        <Field label="Density" htmlFor="display-density">
          <Select
            id="display-density"
            value={prefs.density}
            onChange={(e) => update({ density: e.target.value as DisplayPrefs["density"] })}
            disabled={busy}
            className="max-w-40"
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </Select>
        </Field>
        <Field label="Reduced motion" htmlFor="display-reduced-motion">
          <Select
            id="display-reduced-motion"
            value={prefs.reducedMotion}
            onChange={(e) => update({ reducedMotion: e.target.value as DisplayPrefs["reducedMotion"] })}
            disabled={busy}
            className="max-w-40"
          >
            <option value="system">Match system</option>
            <option value="reduce">Reduce</option>
            <option value="no-preference">No preference</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={prefs.defaultPrivacyBlur}
            onChange={(e) => update({ defaultPrivacyBlur: e.target.checked })}
            disabled={busy}
            className="h-4 w-4 rounded border-panel-border"
          />
          {" "}Blur amounts by default when a session starts
        </label>
        </div>
        {status && <p className="text-xs text-success">{status}</p>}
      </div>
    </Panel>
  );
}
