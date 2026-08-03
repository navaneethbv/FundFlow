import { cn } from "@/lib/cn";
import { emojiForLabel } from "@/lib/category-emoji";

/**
 * Emoji + label, replacing a bare muted category string. The emoji is a
 * glyph, not a series color, so it carries no palette-ceiling interaction —
 * text stays plain foreground, exactly like the category text it replaces.
 * Expects an already-formatted label (e.g. `titleCase(pfc_primary)`); this
 * component only adds the glyph, not the casing.
 */
export default function CategoryChip({
  label,
  className,
}: Readonly<{ label: string; className?: string }>) {
  const emoji = emojiForLabel(label);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {emoji && <span aria-hidden>{emoji}</span>}
      <span>{label}</span>
    </span>
  );
}
