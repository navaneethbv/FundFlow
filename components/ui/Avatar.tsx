import { cn } from "@/lib/cn";

/**
 * Deterministic identity avatars for merchant and institution rows —
 * Transactions, Recurring, Accounts, Dashboard, Reports. No logo storage
 * exists yet (that's a deliberately deferred data-layer change — see
 * the design doc §7 and §4.2), so every avatar renders an initial disc
 * today; `logoUrl` is accepted now so call sites don't need to change
 * shape once a logo pipeline lands.
 *
 * The disc's hue is picked from the seven validated `--viz-*` chart slots,
 * hashed from the name so the same merchant always gets the same color —
 * reusing already dark/light-tested tokens rather than inventing a new
 * avatar-specific palette. This is a decorative identity cue, not a data
 * encoding, so the CVD-separation ceiling that caps chart series at seven
 * doesn't apply here; a little hue reuse across unrelated merchants in a
 * long list is a fine trade against adding an eighth token just for this.
 */
const AVATAR_HUE_VARS = [
  "--viz-1", "--viz-2", "--viz-3", "--viz-4", "--viz-5", "--viz-6", "--viz-7",
] as const;

function hueVarFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return AVATAR_HUE_VARS[hash % AVATAR_HUE_VARS.length]!;
}

export interface AvatarProps {
  name: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}

function Avatar({ name, logoUrl, size = 36, className }: Readonly<AvatarProps>) {
  const trimmed = name.trim();
  const initial = trimmed.charAt(0).toUpperCase() || "?";

  if (logoUrl) {
    return (
      <span
        className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full", className)}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- external/signed logo URL, not a static asset. */}
        <img src={logoUrl} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }

  const hueVar = hueVarFor(trimmed || name);
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.4) }}
      aria-hidden
    >
      <span className="absolute inset-0" style={{ backgroundColor: `var(${hueVar})`, opacity: 0.16 }} />
      <span className="relative" style={{ color: `var(${hueVar})` }}>
        {initial}
      </span>
    </span>
  );
}

/** A merchant/payee row identity (Transactions, Recurring, Dashboard). */
export function MerchantAvatar(props: Readonly<AvatarProps>) {
  return <Avatar {...props} />;
}

/** A bank/institution row identity (Accounts, Recurring payment account). */
export function InstitutionAvatar(props: Readonly<AvatarProps>) {
  return <Avatar {...props} />;
}
