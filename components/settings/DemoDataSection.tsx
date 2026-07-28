"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

/**
 * Demo mode (7.4): load a deterministic sample dataset (blocked while a
 * real bank is connected), or clear it again. For screenshots and demos.
 */
export default function DemoDataSection({ hasBanks }: { hasBanks: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function run(method: "POST" | "DELETE") {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/demo", { method });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        transactions?: number;
      } | null;
      if (!response.ok) {
        setStatus(data?.error ?? "Something went wrong.");
        return;
      }
      setStatus(
        method === "POST"
          ? `Loaded ${data?.transactions ?? 0} sample transactions.`
          : "Sample data cleared.",
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Sample data" eyebrow="Demo mode">
      <p className="mb-4 text-sm text-muted">
        Load six months of realistic fake data to explore or screenshot the
        app — no real numbers involved. Unavailable while a real bank is
        connected.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run("POST")} disabled={busy || hasBanks} size="md">
          Load sample data
        </Button>
        <Button onClick={() => run("DELETE")} disabled={busy} variant="ghost" size="md">
          Clear sample data
        </Button>
      </div>
      {status && <p className="mt-3 text-sm text-muted">{status}</p>}
    </Panel>
  );
}
