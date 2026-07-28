"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

interface TokenRow {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/**
 * Personal read-only API tokens (6.1): for your own scripts against
 * /api/export/*. The plaintext is shown exactly once at mint time.
 */
export default function ApiTokensSection({
  initialTokens,
}: {
  initialTokens: TokenRow[];
}) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mint(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMinted(null);
    const response = await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not create the token.");
      return;
    }
    const data = (await response.json()) as { token: string; row: TokenRow };
    setTokens((rows) => [...rows, { ...data.row, last_used_at: null }]);
    setMinted(data.token);
    setName("");
  }

  async function revoke(id: string) {
    setError(null);
    const response = await fetch("/api/tokens", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) {
      setError("Could not revoke the token.");
      return;
    }
    setTokens((rows) => rows.filter((row) => row.id !== id));
  }

  return (
    <Panel title="API tokens" eyebrow="Your data, your scripts">
      <p className="mb-4 text-sm text-muted">
        Read-only bearer tokens for the export endpoints (
        <code className="text-xs">Authorization: Bearer fft_…</code> against{" "}
        <code className="text-xs">/api/export/csv</code> or{" "}
        <code className="text-xs">/api/export/json</code>). Same privacy
        contract as the downloads — never balances or account numbers.
      </p>

      {tokens.length > 0 && (
        <ul className="mb-4 space-y-2 text-sm">
          {tokens.map((token) => (
            <li key={token.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                <span className="font-semibold">{token.name}</span>
                <span className="text-xs text-muted">
                  {" "}
                  · created {token.created_at.slice(0, 10)}
                  {token.last_used_at
                    ? ` · last used ${token.last_used_at.slice(0, 10)}`
                    : " · never used"}
                </span>
              </span>
              <Button onClick={() => revoke(token.id)} variant="ghost" size="sm">
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={mint} className="flex flex-wrap items-end gap-2">
        <Field label="Token name">
          <Input
            placeholder="spreadsheet-sync"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" size="md">
          Create token
        </Button>
      </form>

      {minted && (
        <div className="mt-3 rounded-field border border-panel-border bg-panel-2 p-3">
          <p className="text-xs font-semibold text-muted">
            Copy this token now — it won&apos;t be shown again:
          </p>
          <code className="mt-1 block break-all text-xs">{minted}</code>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
