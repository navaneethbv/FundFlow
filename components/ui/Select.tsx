import { cn } from "@/lib/cn";
import { fieldClasses } from "@/components/ui/Input";

export default function Select({
  className,
  children,
  ...props
}: Readonly<React.SelectHTMLAttributes<HTMLSelectElement>>) {
  return (
    <select className={cn(fieldClasses, "appearance-none pr-8", className)} {...props}>
      {children}
    </select>
  );
}
