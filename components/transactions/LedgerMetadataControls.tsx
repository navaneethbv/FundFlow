import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import type { LedgerFilters } from "@/lib/ledger-query";

export default function LedgerMetadataControls({ draft, update, parityEnabled, detailsEnabled }: Readonly<{
  draft: LedgerFilters;
  update: (patch: Partial<LedgerFilters>) => void;
  parityEnabled: boolean;
  detailsEnabled: boolean;
}>) {
  return <>
    <label className="text-xs font-semibold text-muted">
      Tag (exact)
      <Input aria-label="Tag (exact)" value={draft.tag ?? ""} maxLength={50} onChange={event => { update({ tag: event.target.value }); }} className="mt-1" placeholder="Any tag" />
    </label>
    <label className="text-xs font-semibold text-muted">
      Tag status
      <Select aria-label="Tag status" value={draft.tagState ?? ""} onChange={event => { update({ tagState: event.target.value as LedgerFilters["tagState"] }); }} className="mt-1">
        <option value="">Any tag status</option><option value="tagged">Tagged</option><option value="untagged">Untagged</option>
      </Select>
    </label>
    <label className="text-xs font-semibold text-muted sm:col-span-2">
      Note contains
      <Input aria-label="Note contains" value={draft.note ?? ""} maxLength={500} onChange={event => { update({ note: event.target.value }); }} className="mt-1" placeholder="Search saved notes" />
    </label>
    {detailsEnabled && <label className="text-xs font-semibold text-muted">
      Cleared status
      <Select aria-label="Cleared status" value={draft.cleared ?? ""} onChange={event => { update({ cleared: event.target.value as LedgerFilters["cleared"] }); }} className="mt-1">
        <option value="">Any cleared status</option><option value="cleared">Cleared</option><option value="uncleared">Uncleared</option>
      </Select>
    </label>}
    {parityEnabled && <>
      <label className="text-xs font-semibold text-muted">
        Transaction source
        <Select aria-label="Transaction source" value={draft.source ?? ""} onChange={event => { update({ source: event.target.value as LedgerFilters["source"] }); }} className="mt-1">
          <option value="">All sources</option><option value="plaid">Bank synced</option><option value="import">Imported</option><option value="manual">Manual</option>
        </Select>
      </label>
      <label className="text-xs font-semibold text-muted">
        Receipt
        <Select aria-label="Receipt" value={draft.receipt ?? ""} onChange={event => { update({ receipt: event.target.value as LedgerFilters["receipt"] }); }} className="mt-1">
          <option value="">Any receipt status</option><option value="attached">Attached</option><option value="missing">Missing</option>
        </Select>
      </label>
    </>}
    <label className="text-xs font-semibold text-muted">
      Split
      <Select aria-label="Split" value={draft.split ?? ""} onChange={event => { update({ split: event.target.value as LedgerFilters["split"] }); }} className="mt-1">
        <option value="">Any split status</option><option value="split">Split</option><option value="unsplit">Unsplit</option>
      </Select>
    </label>
  </>;
}
