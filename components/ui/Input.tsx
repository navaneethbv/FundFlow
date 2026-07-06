import { cn } from "@/lib/cn";

export const fieldClasses =
  "w-full rounded-field border border-panel-border bg-panel-2 px-3 py-2 text-sm text-foreground placeholder:text-muted/70 transition-colors focus:border-accent focus:outline-none";

export default function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClasses, className)} {...props} />;
}
