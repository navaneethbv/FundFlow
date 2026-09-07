"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

export default function AiConsentSection({ initialEnabled, exportAllowed, providerConfigured }: Readonly<{
  initialEnabled: boolean;
  exportAllowed: boolean;
  providerConfigured: boolean;
}>) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saved, setSaved] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/settings/ai", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Your AI preference could not be saved. Please try again.");
      }
      setSaved(enabled);
      setStatus(enabled ? "In-app AI enabled." : "In-app AI disabled.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your AI preference could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleToggle(event: React.ChangeEvent<HTMLInputElement>) {
    setEnabled(event.target.checked);
  }

  return (
    <Panel id="ai-consent" title="In-app AI" eyebrow="Consent" className="xl:col-span-2">
      <div className="max-w-2xl space-y-4 text-sm">
        <p className="text-muted">
          When you request AI insights or ask a question, FundFlow sends monthly category totals and top merchants to Anthropic.
          Account names, balances, and individual transaction rows are excluded.
          Receipt scanning sends only the image you choose, when you request a scan.
        </p>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={handleToggle}
            className="mt-1 h-4 w-4"
          />
          <span>Allow in-app AI processing when I request it</span>
        </label>
        <p className="text-muted">Saving this preference does not generate insights or upload a receipt.</p>
        {!exportAllowed && <p className="text-muted">AI requests are also blocked by your independent <Link className="underline" href="/settings?section=data">data export preference</Link>.</p>}
        {!providerConfigured && <p className="text-muted">AI questions and receipt scanning are not configured on this deployment. Built-in insights remain available when consent permits.</p>}
        <Button loading={busy} disabled={enabled === saved} onClick={save}>Save AI preference</Button>
        {error && <p role="alert" className="text-danger">{error}</p>}
        {status && <output className="block text-success">{status}</output>}
      </div>
    </Panel>
  );
}
