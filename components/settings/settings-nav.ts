/**
 * Phase 13: task-based Settings navigation. Each section queries only the
 * data it needs — the old page fired every section's query on every visit;
 * this is the fix. An invalid or absent `section` param falls back to
 * "profile" rather than 404ing, since Settings is a control center people
 * bookmark and share links into.
 */
export type SettingsSection =
  | "profile"
  | "display"
  | "notifications"
  | "security"
  | "integrations"
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
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  theme: "system",
  density: "comfortable",
  defaultPrivacyBlur: false,
  reducedMotion: "system",
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
  const patch: DisplayPrefsPatch = {};

  if (b.theme !== undefined) {
    if (!THEMES.has(b.theme as ThemePreference)) return { ok: false, error: "invalid theme" };
    patch.theme = b.theme as ThemePreference;
  }
  if (b.density !== undefined) {
    if (!DENSITIES.has(b.density as DensityPreference)) return { ok: false, error: "invalid density" };
    patch.density = b.density as DensityPreference;
  }
  if (b.defaultPrivacyBlur !== undefined) {
    if (typeof b.defaultPrivacyBlur !== "boolean") {
      return { ok: false, error: "defaultPrivacyBlur must be a boolean" };
    }
    patch.defaultPrivacyBlur = b.defaultPrivacyBlur;
  }
  if (b.reducedMotion !== undefined) {
    if (!MOTIONS.has(b.reducedMotion as ReducedMotionPreference)) {
      return { ok: false, error: "invalid reducedMotion" };
    }
    patch.reducedMotion = b.reducedMotion as ReducedMotionPreference;
  }

  return { ok: true, value: patch };
}

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
  };
}
