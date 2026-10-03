import { cn } from "@/lib/cn";

const OWNER_COLORS = [
  "--viz-1",
  "--viz-2",
  "--viz-3",
  "--viz-4",
  "--viz-5",
  "--viz-6",
  "--viz-7",
] as const;

function colorFor(ownerId: string): string {
  let hash = 0;
  for (const character of ownerId) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return OWNER_COLORS[hash % OWNER_COLORS.length] ?? OWNER_COLORS[0];
}

/**
 * Owner attribution is a labelled identity cue, never a colour-only signal.
 * A stable user id keeps a member's dot consistent across accounts and rows.
 */
export default function OwnerDot({
  ownerId,
  viewerId,
  className,
}: Readonly<{ ownerId?: string | null; viewerId?: string; className?: string }>) {
  if (!ownerId) return null;
  const label = ownerId === viewerId ? "You" : "Household member";
  return (
    <span
      title={`Owner: ${label}`}
      className={cn("inline-flex shrink-0 items-center", className)}
    >
      <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: `var(${colorFor(ownerId)})` }} />
      <span className="sr-only">Owner: {label}</span>
    </span>
  );
}
