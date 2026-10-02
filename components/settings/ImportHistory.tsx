import ButtonLink from "@/components/ui/ButtonLink";
import Panel from "@/components/ui/Panel";
import type { ImportHistoryBatch } from "@/lib/import-history";

function utcTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

export default function ImportHistory({ batches }: Readonly<{ batches: ImportHistoryBatch[] }>) {
  return <div className="space-y-4">
    <p className="text-sm text-muted">Committed file reviews, newest upload first. Imported rows include updates to existing transactions. Skipped rows were left out of the latest commit; flagged rows may overlap either count.</p>
    {batches.length === 0 && <Panel><p>No committed imports on this page.</p></Panel>}
    {batches.map(batch => {
      const summary = batch.history_summary;
      return <Panel key={batch.id}>
        <h2 className="text-base font-semibold break-all">{batch.file_name}</h2>
        <p className="mt-1 text-sm text-muted">Uploaded <time dateTime={batch.created_at}>{utcTime(batch.created_at)}</time></p>
        <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-muted">Layout</dt><dd className="break-words">{batch.history_profile_name ?? "Not recorded"}</dd></div>
          <div><dt className="text-muted">Account at import</dt><dd>
            {summary?.targets.map(target => <p className="break-words" key={target.account_id ?? target.manual_account_id}>{target.name}</p>)}
            {(!summary || summary.unknownTargets > 0 || summary.targets.length === 0) && <p>Not recorded</p>}
          </dd></div>
          <div><dt className="text-muted">Last committed</dt><dd>{summary ? <time dateTime={summary.committedAt}>{utcTime(summary.committedAt)}</time> : "Not recorded"}</dd></div>
          <div><dt className="text-muted">Committed by</dt><dd>{summary ? "You" : "Not recorded"}</dd></div>
        </dl>
        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-panel-border pt-4 text-sm">
          <div><dt className="text-muted">Imported rows</dt><dd className="mt-1 text-lg tabular-nums">{summary?.imported ?? "Not recorded"}</dd></div>
          <div><dt className="text-muted">Skipped rows</dt><dd className="mt-1 text-lg tabular-nums">{summary?.skipped ?? "Not recorded"}</dd></div>
          <div><dt className="text-muted">Flagged rows</dt><dd className="mt-1 text-lg tabular-nums">{summary?.flagged ?? "Not recorded"}</dd></div>
        </dl>
      </Panel>;
    })}
  </div>;
}

export function ImportHistoryPagination({ page, hasNext }: Readonly<{ page: number; hasNext: boolean }>) {
  return <nav aria-label="Import history pages" className="flex flex-wrap items-center gap-3">
    {page > 1 && <ButtonLink href={`/settings/import-history?page=${page - 1}`}>Previous page</ButtonLink>}
    <span className="text-sm text-muted">Page {page}</span>
    {hasNext && page < 10000 && <ButtonLink href={`/settings/import-history?page=${page + 1}`}>Next page</ButtonLink>}
  </nav>;
}
