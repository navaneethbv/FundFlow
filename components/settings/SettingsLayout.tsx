"use client";

import Link from "next/link";
import { SETTINGS_SECTIONS, type SettingsSectionKey } from "./settings-nav";

export default function SettingsLayout({
  activeSection = "profile",
  children,
}: Readonly<{
  activeSection?: SettingsSectionKey;
  children: React.ReactNode;
}>) {
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="space-y-1">
        {SETTINGS_SECTIONS.map((sec) => (
          <Link
            key={sec.key}
            href={`/settings?section=${sec.key}`}
            className={`block rounded-field px-3 py-2 text-xs font-semibold transition-colors ${
              activeSection === sec.key
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-panel-hover hover:text-foreground"
            }`}
          >
            {sec.label}
          </Link>
        ))}
      </aside>

      <main>{children}</main>
    </div>
  );
}
