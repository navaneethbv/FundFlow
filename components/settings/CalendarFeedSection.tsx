"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

interface TokenRow {
  id: string;
  include_amounts: boolean;
  created_at: string;
}

/**
 * Bills-in-your-calendar (6.2): mints revocable capability URLs for an
 * iCal feed of upcoming recurring charges and paydays. The URL is shown
 * once — amounts are off by default because calendar providers sync
 * events to their own servers.
 */
export default function CalendarFeedSection({
  initialTokens,
}: {
  initialTokens: TokenRow[];
}) {
  const [tokens, setTokens] = useState<TokenRow[]>(initialTokens);
  const [includeAmounts, setIncludeAmounts] = useState(false);
  const [mintedUrl, setMintedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mint() {
    setError(null);
    setMintedUrl(null);
    const response = await fetch("/api/calendar/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeAmounts }),
    });
    if (!response.ok) {
      setError("Could not create the feed. Try again.");
      return;
    }
    const data = (await response.json()) as { token: string; row: TokenRow };
    setTokens((rows) => [...rows, data.row]);
    setMintedUrl(`${window.location.origin}/api/calendar/${data.token}`);
  }

  async function revoke(id: string) {
    setError(null);
    const response = await fetch("/api/calendar/token", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) {
      setError("Could not revoke the feed.");
      return;
    }
    setTokens((rows) => rows.filter((row) => row.id !== id));
  }

  return (
    <Panel title="Calendar feed" eyebrow="Bills in your calendar">
      <p className="mb-4 text-sm text-muted">
        Subscribe your calendar app to upcoming bills and paydays. Anyone with
        the link can read the feed — treat it like a password and revoke it if
        it leaks.
      </p>

      {tokens.length > 0 && (
        <ul className="mb-4 space-y-2 text-sm">
          {tokens.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3">
              <span className="text-muted">
                Feed created {row.created_at.slice(0, 10)}
                {row.include_amounts ? " · includes amounts" : ""}
              </span>
              <Button onClick={() => revoke(row.id)} variant="ghost" size="sm">
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeAmounts}
          onChange={(e) => setIncludeAmounts(e.target.checked)}
        />
        Include amounts in event titles
      </label>
      <Button onClick={mint} size="md">
        Create feed URL
      </Button>

      {mintedUrl && (
        <div className="mt-3 rounded-field border border-panel-border bg-panel-2 p-3">
          <p className="text-xs font-semibold text-muted">
            Copy this URL now — it won&apos;t be shown again:
          </p>
          <code className="mt-1 block break-all text-xs">{mintedUrl}</code>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
