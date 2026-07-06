import { cn } from "@/lib/cn";

type Tone = "neutral" | "success" | "danger" | "warning" | "accent";

const tones: Record<Tone, string> = {
  neutral: "border-panel-border bg-panel-2 text-muted",
  success:
    "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  danger: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
  warning:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  accent: "border-accent/25 bg-accent-soft text-accent",
};

export default function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
