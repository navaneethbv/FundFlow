import Panel from "@/components/ui/Panel";

export default function ReviewBanner({
  reviewCount,
  children,
}: Readonly<{ reviewCount: number; children: React.ReactNode }>) {
  if (reviewCount === 0) return null;
  return (
    <Panel tone="warning">
      <p className="text-sm font-semibold">
        There {reviewCount === 1 ? "is" : "are"} {reviewCount} new recurring
        merchant{reviewCount === 1 ? "" : "s"} for you to review.
      </p>
      <div className="mt-3">{children}</div>
    </Panel>
  );
}
