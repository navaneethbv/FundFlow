/**
 * Phase 13: task-based Settings navigation. Each section queries only the
 * data it needs — the old page fired every section's query on every visit;
 * this is the fix. An invalid or absent `section` param falls back to
 * "profile" rather than 404ing, since Settings is a control center people
 * bookmark and share links into.
 */
import { DEFAULT_PALETTE, isPaletteId } from "@/lib/themes";
export type SettingsSection =
  | "profile"
  | "display"
  | "notifications"
  | "security"
  | "integrations"
  | "membership"
  | "household-general"
  | "household-preferences"
  | "institutions"
  | "categories"
  | "merchants"
  | "rules"
  | "tags"
  | "data";

export interface SettingsSectionDefinition {
  key: SettingsSection;
  label: string;
  hint: string;
}

export const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
  { key: "profile", label: "Profile", hint: "Name, avatar, birthday" },
  { key: "display", label: "Display", hint: "Theme, density, motion" },
  { key: "notifications", label: "Notifications", hint: "Alerts and delivery" },
  { key: "security", label: "Security", hint: "MFA, sessions, audit log" },
  { key: "integrations", label: "Integrations", hint: "Calendar, API tokens, AI consent" },
  { key: "membership", label: "Membership value", hint: "Fees, rewards, credits, perks" },
  { key: "household-general", label: "Household", hint: "Members and sharing" },
  { key: "household-preferences", label: "Settle up", hint: "Shared expense settlement" },
  { key: "institutions", label: "Institutions", hint: "Banks and manual accounts" },
  { key: "categories", label: "Categories", hint: "Overrides, budgets, sinking funds" },
  { key: "merchants", label: "Merchants", hint: "Cleanup and cancelled subscriptions" },
  { key: "rules", label: "Rules", hint: "Merchant recategorization rules" },
  { key: "tags", label: "Tags", hint: "Rename, merge, and remove" },
  { key: "data", label: "Data", hint: "Import, export, backups, danger zone" },
];

const DEFAULT_SECTION: SettingsSection = "profile";

/** Sections that read profile columns or user_tags added with the settings IA. */
export const MIGRATION_DEPENDENT_SECTIONS: readonly SettingsSection[] = ["profile", "display", "tags"];

/** Navigation entries to hide for the flags that are still off. */
export function hiddenSettingsSections(flags: { settingsIa: boolean; membershipTerms: boolean }): SettingsSection[] {
  const hidden: SettingsSection[] = flags.settingsIa ? [] : [...MIGRATION_DEPENDENT_SECTIONS];
  if (!flags.settingsIa || !flags.membershipTerms) hidden.push("membership");
  return hidden;
}

export function sectionFromParam(raw: string | string[] | undefined): SettingsSection {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = SETTINGS_SECTIONS.find((s) => s.key === value);
  return match ? match.key : DEFAULT_SECTION;
}

export type ThemePreference = "system" | "light" | "dark";
export type DensityPreference = "comfortable" | "compact";
export type ReducedMotionPreference = "system" | "reduce" | "no-preference";

export interface DisplayPrefs {
  theme: ThemePreference;
  density: DensityPreference;
  defaultPrivacyBlur: boolean;
  reducedMotion: ReducedMotionPreference;
  /** Palette id from `LIGHT_PALETTES`, used whenever light mode is showing. */
  lightPalette: string;
  /** Palette id from `DARK_PALETTES`, used whenever dark mode is showing. */
  darkPalette: string;
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  theme: "system",
  density: "comfortable",
  defaultPrivacyBlur: false,
  reducedMotion: "system",
  lightPalette: DEFAULT_PALETTE.light,
  darkPalette: DEFAULT_PALETTE.dark,
};

const THEMES = new Set<ThemePreference>(["system", "light", "dark"]);
const DENSITIES = new Set<DensityPreference>(["comfortable", "compact"]);
const MOTIONS = new Set<ReducedMotionPreference>(["system", "reduce", "no-preference"]);

export type DisplayPrefsPatch = Partial<DisplayPrefs>;
export type DisplayPrefsPatchResult =
  | { ok: true; value: DisplayPrefsPatch }
  | { ok: false; error: string };

/**
 * Strict validator for a write: unlike parseDisplayPrefs (forgiving, for
 * reading whatever is already stored), an incoming PATCH with a bad value
 * should fail loudly rather than silently substitute a default.
 */
export function validateDisplayPrefsPatch(body: unknown): DisplayPrefsPatchResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "display prefs must be an object" };
  }
  const b = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  // Checked in this order so the first invalid field names the error.
  for (const [key, isValid, error] of DISPLAY_PREF_VALIDATORS) {
    if (b[key] === undefined) continue;
    if (!isValid(b[key])) return { ok: false, error };
    patch[key] = b[key];
  }

  return { ok: true, value: patch as DisplayPrefsPatch };
}

const DISPLAY_PREF_VALIDATORS: ReadonlyArray<
  readonly [keyof DisplayPrefsPatch, (value: unknown) => boolean, string]
> = [
  ["theme", (value) => THEMES.has(value as ThemePreference), "invalid theme"],
  ["density", (value) => DENSITIES.has(value as DensityPreference), "invalid density"],
  ["defaultPrivacyBlur", (value) => typeof value === "boolean", "defaultPrivacyBlur must be a boolean"],
  ["reducedMotion", (value) => MOTIONS.has(value as ReducedMotionPreference), "invalid reducedMotion"],
  ["lightPalette", (value) => isPaletteId("light", value), "invalid lightPalette"],
  ["darkPalette", (value) => isPaletteId("dark", value), "invalid darkPalette"],
];

/** Defensive parse of the `profiles.display_prefs` JSON — never throws on bad data. */
export function parseDisplayPrefs(raw: unknown): DisplayPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DISPLAY_PREFS };
  const r = raw as Record<string, unknown>;
  return {
    theme: THEMES.has(r.theme as ThemePreference) ? (r.theme as ThemePreference) : DEFAULT_DISPLAY_PREFS.theme,
    density: DENSITIES.has(r.density as DensityPreference)
      ? (r.density as DensityPreference)
      : DEFAULT_DISPLAY_PREFS.density,
    defaultPrivacyBlur: typeof r.defaultPrivacyBlur === "boolean" ? r.defaultPrivacyBlur : DEFAULT_DISPLAY_PREFS.defaultPrivacyBlur,
    reducedMotion: MOTIONS.has(r.reducedMotion as ReducedMotionPreference)
      ? (r.reducedMotion as ReducedMotionPreference)
      : DEFAULT_DISPLAY_PREFS.reducedMotion,
    lightPalette: isPaletteId("light", r.lightPalette) ? r.lightPalette : DEFAULT_DISPLAY_PREFS.lightPalette,
    darkPalette: isPaletteId("dark", r.darkPalette) ? r.darkPalette : DEFAULT_DISPLAY_PREFS.darkPalette,
  };
}
