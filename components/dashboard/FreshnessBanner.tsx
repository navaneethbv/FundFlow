import Link from "next/link";
import Panel from "@/components/ui/Panel";

export default function FreshnessBanner({
  brokenBanks,
  isStale,
}: {
  brokenBanks: { institution_name: string | null }[];
  isStale: boolean;
}) {
  if (brokenBanks.length === 0 && !isStale) return null;

  return (
    <Panel tone="warning" padding="md" className="text-sm">
      {brokenBanks.length > 0 ? (
        <>
          <span className="font-semibold">
            {brokenBanks.map((b) => b.institution_name ?? "A bank").join(", ")} lost its connection
          </span>
          , data may be stale.{" "}
          <Link href="/settings" className="font-semibold underline">
            Reconnect in Settings
          </Link>
        </>
      ) : (
        <>
          <span className="font-semibold">Data may be stale</span>, no successful sync in the last
          48 hours. Try Refresh, and check your banks in{" "}
          <Link href="/settings" className="font-semibold underline">
            Settings
          </Link>
          .
        </>
      )}
    </Panel>
  );
}
