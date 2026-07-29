export type SettingsSectionKey =
  | "profile"
  | "display"
  | "notifications"
  | "security"
  | "integrations"
  | "household"
  | "institutions"
  | "categories"
  | "merchants"
  | "rules"
  | "tags"
  | "data";

export interface SettingsSectionDef {
  key: SettingsSectionKey;
  label: string;
  description: string;
}

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { key: "profile", label: "Profile", description: "Personal details and account identity" },
  { key: "display", label: "Display", description: "Theme, density, and interface options" },
  { key: "notifications", label: "Notifications", description: "Email and in-app alert preferences" },
  { key: "security", label: "Security", description: "MFA, active sessions, and audit log" },
  { key: "integrations", label: "Integrations", description: "Connected banks and personal API tokens" },
  { key: "household", label: "Household", description: "Shared access and joint accounts" },
  { key: "institutions", label: "Institutions & Accounts", description: "Manage linked accounts and manual items" },
  { key: "categories", label: "Categories", description: "Custom category renames and overrides" },
  { key: "merchants", label: "Merchants", description: "Merchant cleanup and subscription rules" },
  { key: "rules", label: "Rules", description: "Automated transaction categorization rules" },
  { key: "tags", label: "Tags", description: "Custom transaction tags" },
  { key: "data", label: "Data & Export", description: "Takeout, encrypted backups, and account deletion" },
];
