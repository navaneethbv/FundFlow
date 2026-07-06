import { cn } from "@/lib/cn";

type Tone = "default" | "danger" | "warning" | "success" | "accent";

const tones: Record<Tone, string> = {
  default: "border-panel-border bg-panel",
  danger: "border-danger/30 bg-danger/[0.06]",
  warning: "border-amber-500/35 bg-amber-500/10",
  success: "border-success/30 bg-success/[0.06]",
  accent: "border-accent/30 bg-accent-soft",
};

/** The app's card surface: flat panel, hairline border, soft elevation. */
export default function Panel({
  eyebrow,
  title,
  action,
  tone = "default",
  padding = "md",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  eyebrow?: string;
  title?: React.ReactNode;
  action?: React.ReactNode;
  tone?: Tone;
  padding?: "none" | "md" | "lg";
}) {
  return (
    <section
      className={cn(
        "rounded-card border shadow-card",
        tones[tone],
        padding === "md" && "p-5",
        padding === "lg" && "p-5 sm:p-6",
        className,
      )}
      {...props}
    >
      {(title || eyebrow || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && (
              <h2 className="text-sm font-bold tracking-tight">{title}</h2>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
