"use client";

import { useRouter } from "next/navigation";
import type {
  SettingsSection,
  SettingsSectionDefinition,
} from "@/components/settings/settings-nav";

export default function SettingsSectionPicker({
  active,
  sections,
}: Readonly<{
  active: SettingsSection;
  sections: SettingsSectionDefinition[];
}>) {
  const router = useRouter();

  return (
    <label className="block lg:hidden">
      <span className="eyebrow mb-2 block">Settings section</span>
      <select
        aria-label="Settings section"
        value={active}
        onChange={(event) => {
          router.push(`/settings?section=${event.target.value}`);
        }}
        className="min-h-11 w-full rounded-field border border-panel-border bg-panel px-3 text-sm font-semibold text-foreground"
      >
        {sections.map((section) => (
          <option key={section.key} value={section.key}>
            {section.label}: {section.hint}
          </option>
        ))}
      </select>
    </label>
  );
}
