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
  for (const character of ownerId) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return OWNER_COLORS[hash % OWNER_COLORS.length]!;
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
      role="img"
      aria-label={`Owner: ${label}`}
      title={`Owner: ${label}`}
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: `var(${colorFor(ownerId)})` }}
    />
  );
}
