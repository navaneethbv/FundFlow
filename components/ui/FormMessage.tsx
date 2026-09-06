import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface FormMessageProps {
  type?: "error" | "status";
  message?: ReactNode;
  className?: string;
  id?: string;
}

/**
 * Accessible form error and status announcer.
 * Ensures async error messages are announced to screen readers via role="alert"
 * and status messages via <output role="status">.
 */
export default function FormMessage({
  type = "error",
  message,
  className,
  id,
}: Readonly<FormMessageProps>) {
  if (!message) return null;

  if (type === "status") {
    return (
      <output
        id={id}
        role="status"
        className={cn("block text-xs text-muted", className)}
      >
        {message}
      </output>
    );
  }

  return (
    <p
      id={id}
      role="alert"
      className={cn("text-xs font-medium text-danger", className)}
    >
      {message}
    </p>
  );
}
