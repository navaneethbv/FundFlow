import { Children, cloneElement, isValidElement } from "react";
import Label from "@/components/ui/Label";

function enhanceElement(
  node: React.ReactNode,
  describedBy?: string,
  hasError?: boolean,
  htmlFor?: string,
): React.ReactNode {
  return Children.map(node, (child) => {
    if (
      !isValidElement<{
        id?: string;
        "aria-describedby"?: string;
        "aria-invalid"?: boolean | "true" | "false";
        children?: React.ReactNode;
      }>(child)
    ) {
      return child;
    }

    // Skip non-interactive or non-target tags like datalist
    if (child.type === "datalist" || child.type === "label") {
      return child;
    }

    const isExplicitMatch = htmlFor ? child.props.id === htmlFor : false;
    const isCandidateControl =
      typeof child.type === "string"
        ? ["input", "select", "textarea", "button"].includes(child.type.toLowerCase())
        : true;

    if (isExplicitMatch || (!htmlFor && isCandidateControl) || (htmlFor && !child.props.id && isCandidateControl)) {
      const existingDescribedBy = child.props["aria-describedby"];
      const mergedDescribedBy = existingDescribedBy
        ? `${existingDescribedBy} ${describedBy}`
        : describedBy;
      return cloneElement(child, {
        ...(describedBy ? { "aria-describedby": mergedDescribedBy } : {}),
        ...(hasError ? { "aria-invalid": true } : {}),
      });
    }

    if (child.props.children && typeof child.props.children !== "string") {
      return cloneElement(child, {
        children: enhanceElement(child.props.children, describedBy, hasError, htmlFor),
      });
    }

    return child;
  });
}

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

  const enhancedChildren = describedBy || error
    ? enhanceElement(children, describedBy, Boolean(error), htmlFor)
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
