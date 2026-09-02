import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
} from "react";
import Label from "@/components/ui/Label";

interface EnhanceableProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  children?: React.ReactNode;
}

function isCandidateControl(child: ReactElement<EnhanceableProps>): boolean {
  if (typeof child.type !== "string") return true;
  return ["input", "select", "textarea", "button"].includes(
    child.type.toLowerCase(),
  );
}

function shouldEnhanceControl(
  child: ReactElement<EnhanceableProps>,
  isSoleChild: boolean,
  htmlFor?: string,
): boolean {
  if (htmlFor && child.props.id === htmlFor) return true;
  if (!isSoleChild || !isCandidateControl(child)) return false;
  return !htmlFor || !child.props.id;
}

function enhanceControl(
  child: ReactElement<EnhanceableProps>,
  describedBy?: string,
  hasError?: boolean,
): ReactElement<EnhanceableProps> {
  const existingDescribedBy = child.props["aria-describedby"];
  const mergedDescribedBy = existingDescribedBy
    ? `${existingDescribedBy} ${describedBy}`
    : describedBy;

  return cloneElement(child, {
    ...(describedBy ? { "aria-describedby": mergedDescribedBy } : {}),
    ...(hasError ? { "aria-invalid": true } : {}),
  });
}

function enhanceElement(
  node: React.ReactNode,
  describedBy?: string,
  hasError?: boolean,
  htmlFor?: string,
): React.ReactNode {
  // Only trust an id-less "candidate control" guess when it's the sole
  // child at this level — with siblings present (e.g. a submit Button next
  // to the labeled input), guessing would tag every sibling that happens to
  // share a non-string element type, not just the actual control. An
  // explicit id === htmlFor match is unambiguous and always trusted.
  const isSoleChild = Children.count(node) === 1;

  return Children.map(node, (child) => {
    if (!isValidElement<EnhanceableProps>(child)) {
      return child;
    }

    // Skip non-interactive or non-target tags like datalist
    if (child.type === "datalist" || child.type === "label") {
      return child;
    }

    if (shouldEnhanceControl(child, isSoleChild, htmlFor)) {
      return enhanceControl(child, describedBy, hasError);
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
