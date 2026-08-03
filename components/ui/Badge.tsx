import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "success" | "danger" | "warning" | "accent";
type Tone = BadgeTone;

const tones: Record<Tone, string> = {
  neutral: "border-panel-border bg-panel-2 text-muted",
  success: "border-success/25 bg-success/10 text-success",
  danger: "border-danger/25 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
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
