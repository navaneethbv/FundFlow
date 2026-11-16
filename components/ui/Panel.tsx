import { cn } from "@/lib/cn";

type Tone = "default" | "danger" | "warning" | "success" | "accent";

const tones: Record<Tone, string> = {
  default: "border-transparent bg-panel",
  danger: "border-danger/30 bg-danger/[0.06]",
  warning: "border-warning/35 bg-warning/10",
  success: "border-success/30 bg-success/[0.06]",
  accent: "border-accent/30 bg-accent-soft",
};

/**
 * The app's card surface: a flat panel lifted off the page by tone and a soft
 * shadow, with no visible border. A titled panel gets a full-bleed header row
 * closed by a hairline, which is why padding is a variable: the header has to
 * cancel exactly the padding the section applied (docs/MONARCH_LOOK.md).
 */
export default function Panel({
  eyebrow,
  title,
  action,
  tone = "default",
  padding = "md",
  className,
  children,
  ...props
}: Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  eyebrow?: string;
  title?: React.ReactNode;
  action?: React.ReactNode;
  tone?: Tone;
  padding?: "none" | "md" | "lg";
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-card border shadow-card",
        tones[tone],
        padding === "md" && "p-[var(--panel-pad,1.25rem)]",
        padding === "lg" && "p-[var(--panel-pad,1.25rem)] sm:p-[var(--panel-pad,1.5rem)]",
        className,
      )}
      {...props}
    >
      {(title || eyebrow || action) && (
        <div
          className={cn(
            "mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:flex-wrap sm:items-center",
            padding === "md" &&
              "-mx-[var(--panel-pad,1.25rem)] -mt-[var(--panel-pad,1.25rem)] border-b border-panel-2 px-5 py-3",
            padding === "lg" &&
              "-mx-[var(--panel-pad,1.25rem)] -mt-[var(--panel-pad,1.25rem)] border-b border-panel-2 px-5 py-3 sm:-mx-[var(--panel-pad,1.5rem)] sm:-mt-[var(--panel-pad,1.5rem)] sm:px-6",
          )}
        >
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2 className="card-title">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
