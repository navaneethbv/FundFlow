import { cn } from "@/lib/cn";

export const fieldClasses =
  "min-h-11 w-full rounded-field border border-panel-border bg-panel-2 px-3 py-2 text-sm text-foreground placeholder:text-muted transition-colors focus:border-accent focus-visible:outline-2";

export default function Input({
  className,
  ...props
}: Readonly<React.InputHTMLAttributes<HTMLInputElement>>) {
  return <input className={cn(fieldClasses, className)} {...props} />;
}
