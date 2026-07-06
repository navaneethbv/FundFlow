import Badge from "@/components/ui/Badge";
import Panel from "@/components/ui/Panel";
import ConnectBankButton from "@/components/ConnectBankButton";
import RefreshButton from "@/components/RefreshButton";
import { formatMinutesAgo } from "@/lib/format";

export default function ActionBar({
  hasBanks,
  itemCount,
  hasBrokenBanks,
  lastSyncAgoMinutes,
}: {
  hasBanks: boolean;
  itemCount: number;
  hasBrokenBanks: boolean;
  lastSyncAgoMinutes: number | null;
}) {
  return (
    <Panel padding="md">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <ConnectBankButton />
          {hasBanks && <RefreshButton />}
          {hasBanks && (
            <span className="text-xs font-medium text-muted" title="Newest successful sync">
              Updated: {formatMinutesAgo(lastSyncAgoMinutes)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{itemCount} Account{itemCount === 1 ? "" : "s"} connected</Badge>
          <Badge tone={hasBrokenBanks ? "danger" : "success"}>
            {hasBrokenBanks ? "Attention needed" : "All systems operational"}
          </Badge>
        </div>
      </div>
    </Panel>
  );
}
