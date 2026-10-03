import Link from "next/link";
import { manualAssetsEnabled } from "@/lib/manual-asset-flags";

export default function ManualAssetNotice() {
  if (!manualAssetsEnabled()) return null;
  return <p className="text-sm text-muted">Manual asset growth values are estimates, counted at your owned share. <Link className="underline" href="/accounts/assets">Review valuation dates and assumptions</Link>.</p>;
}
