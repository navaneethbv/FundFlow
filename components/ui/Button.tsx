import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  // 44px stays the touch target; a mouse or trackpad gets the denser 36px
  // control the reference design uses (docs/MONARCH_LOOK.md, "Buttons").
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-field font-medium transition-all duration-150 focus-visible:outline-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 pointer-fine:min-h-9";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-accent-strong-foreground shadow-sm hover:brightness-110",
  secondary:
    "border border-panel-border bg-panel text-foreground shadow-sm hover:bg-panel-2",
  ghost: "text-muted hover:bg-panel-hover hover:text-foreground",
  danger: "bg-danger text-danger-foreground shadow-sm hover:brightness-110",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-3 py-1.5 text-sm",
  lg: "w-full px-4 py-2 text-sm",
};

export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(base, variants[variant], sizes[size], className);
}

/** Spinner for pending states; pure CSS, inherits currentColor. */
export function ButtonSpinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      className={buttonVariants({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <ButtonSpinner />}
      {loading && <span className="sr-only">Loading…</span>}
      {children}
    </button>
  );
}
