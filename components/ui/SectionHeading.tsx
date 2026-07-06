/** Uppercase eyebrow section label with optional right-aligned action. */
export default function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="eyebrow">{title}</h2>
      {action}
    </div>
  );
}
