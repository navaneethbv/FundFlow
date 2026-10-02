"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";

export default function BayesCategorizeButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function responseMessage(
    response: Response,
    payload: {
      applied?: number;
      suggestions?: unknown[];
      reason?: string;
      error?: string;
    },
  ): string {
    if (!response.ok) return payload.error ?? "Categorization failed.";
    if (payload.applied) return `Categorized ${payload.applied} rows.`;
    if (payload.reason)
      return `Bayes categorization unavailable: ${payload.reason.replaceAll("_", " ")}.`;
    return "No confident categories found.";
  }

  async function run() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/categorization/bayes", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        applied?: number;
        suggestions?: unknown[];
        reason?: string;
        error?: string;
      };
      setMessage(responseMessage(response, payload));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Categorization failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={() => void run()} loading={pending}>
        Categorize uncategorized
      </Button>
      {message && (
        <output aria-live="polite" className="text-xs text-muted">
          {message}
        </output>
      )}
    </div>
  );
}
