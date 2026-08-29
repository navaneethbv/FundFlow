import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "success" | "danger" | "warning" | "accent";

const tones: Record<BadgeTone, string> = {
  neutral: "border-panel-border bg-panel-2 text-muted",
  // Solid fills, not tinted /10 backgrounds: an alpha-tinted bg leaves the
  // token text just under WCAG AA on some surfaces (axe measured 4.28:1).
  success: "border-success/25 bg-success text-success-foreground",
  danger: "border-danger/25 bg-danger text-danger-foreground",
  warning: "border-warning/30 bg-warning text-warning-foreground",
  accent: "border-accent/25 bg-accent-soft text-accent",
};

export default function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
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
