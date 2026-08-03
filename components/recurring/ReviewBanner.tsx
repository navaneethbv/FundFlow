import Link from "next/link";
import Panel from "@/components/ui/Panel";

export default function ReviewBanner({
  reviewCount,
  reviewHref,
}: Readonly<{ reviewCount: number; reviewHref: string }>) {
  if (reviewCount === 0) return null;
  return (
    <Panel tone="accent" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-semibold">
        There {reviewCount === 1 ? "is" : "are"} {reviewCount} new recurring
        merchant{reviewCount === 1 ? "" : "s"} for you to review.
      </p>
      <Link
        href={reviewHref}
        className="inline-flex min-h-11 items-center text-sm font-bold text-accent hover:underline"
      >
        Review now
      </Link>
    </Panel>
  );
}
