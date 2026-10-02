"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";

export default function BayesCategorizeButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function run() {
    setPending(true); setMessage(null);
    try {
      const response = await fetch("/api/categorization/bayes", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { applied?: number; suggestions?: unknown[]; reason?: string; error?: string };
      setMessage(response.ok ? payload.applied ? `Categorized ${payload.applied} rows.` : payload.reason ? `Bayes categorization unavailable: ${payload.reason.replaceAll("_", " ")}.` : "No confident categories found." : payload.error ?? "Categorization failed.");
    } finally { setPending(false); }
  }
  return <div className="flex items-center gap-2"><Button variant="secondary" onClick={() => void run()} loading={pending}>Categorize uncategorized</Button>{message && <output aria-live="polite" className="text-xs text-muted">{message}</output>}</div>;
}
