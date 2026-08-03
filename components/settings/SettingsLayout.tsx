import Link from "next/link";
import { cn } from "@/lib/cn";
import { SETTINGS_SECTIONS, type SettingsSection, type SettingsSectionDefinition } from "@/components/settings/settings-nav";
import SettingsSectionPicker from "@/components/settings/SettingsSectionPicker";

/**
 * "Account" (profile-owned preferences) vs "Household" (shared data and
 * management) — Monarch's own two-card split. Every current section falls
 * into exactly one of these two groups; a section added later that isn't
 * about personal preferences defaults into Household rather than silently
 * vanishing from the nav.
 */
const ACCOUNT_SECTIONS = new Set<SettingsSection>([
  "profile",
  "display",
  "notifications",
  "security",
  "integrations",
]);

function SectionGroup({
  label,
  sections,
  active,
}: Readonly<{ label: string; sections: SettingsSectionDefinition[]; active: SettingsSection }>) {
  if (sections.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-card border border-panel-border bg-panel">
      <p className="eyebrow px-3 pt-3">{label}</p>
      <nav aria-label={`${label} settings`} className="space-y-1 p-2">
        {sections.map((section) => (
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
    </div>
  );
}

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
  children?: React.ReactNode;
}>) {
  const visibleSections = SETTINGS_SECTIONS.filter((s) => !hiddenSections.includes(s.key));
  const accountSections = visibleSections.filter((s) => ACCOUNT_SECTIONS.has(s.key));
  const householdSections = visibleSections.filter((s) => !ACCOUNT_SECTIONS.has(s.key));

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <SettingsSectionPicker active={active} sections={visibleSections} />
      <div className="hidden min-w-0 space-y-4 lg:block">
        <SectionGroup label="Account" sections={accountSections} active={active} />
        <SectionGroup label="Household" sections={householdSections} active={active} />
      </div>
      <div className="min-w-0 space-y-6">{children}</div>
    </div>
  );
}
