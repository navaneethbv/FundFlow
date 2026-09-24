import {
  isPaletteId,
  PALETTE_ATTRIBUTE,
  PALETTE_STORAGE_KEY,
  type ThemeMode,
} from "@/lib/themes";

/**
 * Applies one mode's palette to `<html>` and remembers it for the pre-paint
 * script, so the next load paints in the right colours before hydration.
 * Storage can be unavailable (private windows, blocked site data); the
 * attribute still applies for this page.
 */
export function applyPalette(mode: ThemeMode, id: string): void {
  if (!isPaletteId(mode, id)) return;
  document.documentElement.setAttribute(PALETTE_ATTRIBUTE[mode], id);
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY[mode], id);
  } catch {
    // Non-persistent this session; the profile copy still follows the user.
  }
}
