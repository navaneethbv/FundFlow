import Link from "next/link";
import { cn } from "@/lib/cn";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/components/settings/settings-nav";
import SettingsSectionPicker from "@/components/settings/SettingsSectionPicker";

/**
 * Task-based side navigation. Each link is a plain `<Link>` to
 * `/settings?section=...` — no client state, so the active section is
 * always exactly what the URL says, and every section is a shareable link.
 */
export default function SettingsLayout({
  active,
  hiddenSections = [],
  children,
}: Readonly<{
  active: SettingsSection;
  /** Sections not yet reachable on this deployment (e.g. pending a migration). */
  hiddenSections?: SettingsSection[];
  children: React.ReactNode;
}>) {
  const visibleSections = SETTINGS_SECTIONS.filter((s) => !hiddenSections.includes(s.key));
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <SettingsSectionPicker active={active} sections={visibleSections} />
      <nav aria-label="Settings sections" className="hidden min-w-0 space-y-1 lg:block">
        {visibleSections.map((section) => (
          <Link
            key={section.key}
            href={`/settings?section=${section.key}`}
            aria-current={active === section.key ? "page" : undefined}
            className={cn(
              "block min-h-11 rounded-field px-3 py-2 text-sm font-semibold transition-colors",
              active === section.key
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-panel-hover hover:text-foreground",
            )}
          >
            {section.label}
            <span className="block text-xs font-normal text-muted">{section.hint}</span>
          </Link>
        ))}
      </nav>
      <div className="min-w-0 space-y-6">{children}</div>
    </div>
  );
}
