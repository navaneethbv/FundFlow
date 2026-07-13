import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import Panel from "@/components/ui/Panel";

export default function ReportsSection() {
  return (
    <Panel title="Reports and email" eyebrow="Notification center" action={<Badge tone="accent">Centralized</Badge>}>
      <p className="mb-4 text-sm text-muted">
        Choose weekly and daily email delivery, set your timezone, and review report history in one place.
      </p>
      <ButtonLink href="/notifications">Manage notifications</ButtonLink>
    </Panel>
  );
}
