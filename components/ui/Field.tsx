import { Children, cloneElement, isValidElement } from "react";
import Label from "@/components/ui/Label";

/** Label + control + optional hint/error, stacked. */
export default function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: Readonly<{
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children?: React.ReactNode;
}>) {
  const errorId = htmlFor && error ? `${htmlFor}-error` : undefined;
  const hintId = htmlFor && hint && !error ? `${htmlFor}-hint` : undefined;
  const describedBy = errorId ?? hintId;

  const enhancedChildren = describedBy
    ? Children.map(children, (child) => {
        if (
          !isValidElement<{
            "aria-describedby"?: string;
            "aria-invalid"?: boolean | "true" | "false";
          }>(child)
        ) {
          return child;
        }
        const existingDescribedBy = child.props["aria-describedby"];
        const mergedDescribedBy = existingDescribedBy
          ? `${existingDescribedBy} ${describedBy}`
          : describedBy;
        return cloneElement(child, {
          "aria-describedby": mergedDescribedBy,
          ...(error ? { "aria-invalid": true } : {}),
        });
      })
    : children;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {enhancedChildren}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
