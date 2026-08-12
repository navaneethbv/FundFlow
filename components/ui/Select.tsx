import { cn } from "@/lib/cn";
import { fieldClasses } from "@/components/ui/Input";

export default function Select({
  className,
  children,
  ...props
}: Readonly<React.SelectHTMLAttributes<HTMLSelectElement>>) {
  return (
    <div className="relative">
      <select className={cn(fieldClasses, "appearance-none pr-8", className)} {...props}>
        {children}
      </select>
      {/* The native arrow is removed by appearance-none; supply an explicit
          affordance so the control still reads as a dropdown. */}
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
      >
        <path
          d="M5 8l5 5 5-5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
