import { cn } from "@/lib/cn";

export default function Label({
  className,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-xs font-semibold text-muted", className)}
      {...props}
    >
      {children}
    </label>
  );
}
