import { cn } from "@/lib/cn";

export const fieldClasses =
  "min-h-11 w-full rounded-field border border-panel-border bg-panel-2 px-3 py-2 text-sm text-foreground placeholder:text-muted transition-all duration-150 hover:border-panel-border/80 focus:border-accent focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50";

export default function Input({
  className,
  ...props
}: Readonly<React.InputHTMLAttributes<HTMLInputElement>>) {
  return <input className={cn(fieldClasses, className)} {...props} />;
}
