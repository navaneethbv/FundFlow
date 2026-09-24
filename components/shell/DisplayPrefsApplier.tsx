"use client";

import { useEffect } from "react";
import { PRIVACY_CHANGE_EVENT } from "@/components/PrivacyToggle";
import type { DisplayPrefs } from "@/components/settings/settings-nav";
import { applyPalette } from "@/lib/theme-client";

const THEME_KEY = "fundflow-theme";
const PRIVACY_KEY = "fundflow-privacy";
/** Marks that this browser session already applied the blur default. */
const SESSION_BLUR_KEY = "fundflow-privacy-session";

/**
 * Applies the saved Display preferences on every signed-in page. They were
 * written to `profiles.display_prefs` but never read back, so the Settings
 * panel's promise ("the persisted default every fresh session starts from")
 * was not kept.
 *
 * - Palettes: the profile is canonical, so a choice follows the user across
 *   devices; the local copy only exists for the pre-paint script.
 * - Theme: a device-local choice from the quick toggle wins; the saved
 *   default applies only where the device has none.
 * - Density and reduced motion: `<html>` attributes that globals.css reads.
 * - Default blur: applied once when a browser session starts, so turning
 *   blur off mid-session sticks until the next session.
 */
export default function DisplayPrefsApplier({ prefs }: Readonly<{ prefs: DisplayPrefs }>) {
  useEffect(() => {
    const root = document.documentElement;
    applyPalette("light", prefs.lightPalette);
    applyPalette("dark", prefs.darkPalette);
    root.dataset.density = prefs.density;
    root.dataset.motion = prefs.reducedMotion;
    try {
      if (prefs.theme !== "system" && !localStorage.getItem(THEME_KEY)) {
        root.dataset.theme = prefs.theme;
      }
      if (prefs.defaultPrivacyBlur && !sessionStorage.getItem(SESSION_BLUR_KEY)) {
        sessionStorage.setItem(SESSION_BLUR_KEY, "1");
        localStorage.setItem(PRIVACY_KEY, "blur");
        root.dataset.privacy = "blur";
        window.dispatchEvent(new Event(PRIVACY_CHANGE_EVENT));
      }
    } catch {
      // Storage blocked: attributes above still apply for this page.
    }
  }, [prefs]);

  return null;
}
