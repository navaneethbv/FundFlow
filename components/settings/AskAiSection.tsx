"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

/**
 * "Ask your money" (Bucket 2): one question in, one grounded answer out —
 * over the same privacy-safe aggregates the AI insights use. No chat, no
 * history, 10 questions/day.
 */
export default function AskAiSection({ enabled }: { enabled: boolean }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAnswer(null);
    setBusy(true);
    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      const data = (await response.json().catch(() => null)) as {
        answer?: string;
        error?: string;
      } | null;
      if (!response.ok) {
        setError(data?.error ?? "Could not get an answer.");
        return;
      }
      setAnswer(data?.answer ?? "No answer produced.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Ask your money" eyebrow="One question at a time">
      <p className="mb-4 text-sm text-muted">
        Ask a question about your own spending (&ldquo;how much did
        restaurants cost me this spring?&rdquo;). Uses only the privacy-safe
        aggregates — never balances or account details.
      </p>
      {!enabled && (
        <p className="mb-3 text-xs text-warning">
          Enable AI insights above to use this.
        </p>
      )}
      <form onSubmit={ask} className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="How much did I spend on groceries last month?"
          value={question}
          maxLength={300}
          onChange={(e) => setQuestion(e.target.value)}
          className="min-w-0 flex-1"
          required
          disabled={!enabled || busy}
        />
        <Button type="submit" size="md" disabled={!enabled || busy}>
          {busy ? "Thinking…" : "Ask"}
        </Button>
      </form>
      {answer && (
        <p className="mt-3 rounded-field border border-panel-border bg-panel-2 p-3 text-sm">
          {answer}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
