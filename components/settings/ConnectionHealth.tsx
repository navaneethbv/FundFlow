import ButtonLink from "@/components/ui/ButtonLink";
import Panel from "@/components/ui/Panel";
import ReconnectBankButton from "@/components/settings/ReconnectBankButton";
import RepairBankButton from "@/components/settings/RepairBankButton";
import type {
  ConnectionHealthRow,
  ConnectionState,
} from "@/lib/connection-health";
import { formatTimestampUtc } from "@/lib/format-date";
const STATES: Array<{ state: ConnectionState; label: string }> = [
  { state: "reconnect", label: "Reconnect needed" },
  { state: "sync_error", label: "Sync needs attention" },
  { state: "account_review", label: "Account review needed" },
  { state: "healthy", label: "Current connections" },
];
function RecoveryAction({ row }: Readonly<{ row: ConnectionHealthRow }>) {
  if (row.state === "reconnect") return <ReconnectBankButton itemId={row.id} />;
  if (row.state === "sync_error") return <RepairBankButton itemId={row.id} />;
  if (row.state === "account_review")
    return (
      <ButtonLink
        href={
          row.pendingReviews
            ? "/accounts/balance-review"
            : "/settings?section=institutions"
        }
      >
        {row.pendingReviews ? "Review balances" : "Review accounts"}
      </ButtonLink>
    );
  return null;
}
export default function ConnectionHealth({
  rows,
  manualAccounts,
}: Readonly<{ rows: ConnectionHealthRow[]; manualAccounts: number }>) {
  return (
    <div className="space-y-6">
      <Panel>
        <p>
          {rows.reduce((total, row) => total + row.linkedAccounts, 0)} linked
          bank accounts; {manualAccounts} manual accounts without a bank
          connection.
        </p>
        <p className="mt-2 text-sm text-muted">
          Unlinked accounts at the provider: not reported. FundFlow records the
          accounts shared through bank authorization; it cannot count accounts
          the bank has not shared.
        </p>
      </Panel>
      {rows.length === 0 && (
        <p>No bank connections yet. Connect a bank in institution settings.</p>
      )}
      {STATES.map(({ state, label }) => {
        const matches = rows.filter((row) => row.state === state);
        if (!matches.length) return null;
        return (
          <section key={state} aria-label={label} className="space-y-3">
            <h2 className="text-lg font-semibold">
              {label} ({matches.length})
            </h2>
            {matches.map((row) => (
              <Panel key={row.id}>
                <h3 className="font-semibold">{row.name}</h3>
                <p className="mt-1 text-sm">{row.detail}</p>
                <p className="mt-2 text-sm text-muted">
                  {row.linkedAccounts} linked accounts; {row.pendingReviews}{" "}
                  pending balance reviews.
                </p>
                <p className="mt-1 text-sm text-muted">
                  Last successful transaction sync:{" "}
                  {row.lastSuccessAt
                    ? formatTimestampUtc(row.lastSuccessAt)
                    : "Not recorded"}
                </p>
                <div className="mt-3">
                  <RecoveryAction row={row} />
                </div>
              </Panel>
            ))}
          </section>
        );
      })}
    </div>
  );
}
