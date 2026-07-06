import { cn } from "@/lib/cn";

/** Brand mark: blue rounded square with a white cash-flow wave. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-white shadow-pop",
        className,
      )}
      style={{ background: "var(--accent-gradient)" }}
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
        <path
          d="M4 15c2.6 0 3.4-6 6-6s3.4 6 6 6 3-4 4-4"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export default function Logo({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={markClassName} />
      <span className="text-lg font-bold tracking-tight">FundFlow</span>
    </span>
  );
}
