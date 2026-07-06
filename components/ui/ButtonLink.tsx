import Link from "next/link";
import {
  buttonVariants,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/ui/Button";

/** Next <Link> styled as a Button; for navigations and downloads. */
export default function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: React.ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <Link className={buttonVariants({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}
