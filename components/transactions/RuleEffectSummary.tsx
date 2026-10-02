"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import type { RuleActions } from "@/lib/rule-actions";
export default function RuleEffectSummary({
  transactionId,
  actions,
}: Readonly<{ transactionId: string; actions: RuleActions }>) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function clear() {
    setBusy(true);
    try {
      const response = await fetch("/api/rules/effect", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionId }),
      });
      if (!response.ok)
        throw new Error("Could not remove rule changes. Refresh and retry.");
      setStatus(
        "Rule changes removed. Disable the rule in Settings to prevent future application.",
      );
      router.refresh();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not remove changes.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="my-3 rounded-field border border-panel-border p-3 text-sm"
      aria-label="Applied rule actions"
    >
      <p>
        Applied rule:{" "}
        {[
          actions.displayName && `name ${actions.displayName}`,
          actions.category && `category ${actions.category}`,
          actions.exclude && "excluded from totals",
          actions.transfer && "marked transfer",
          actions.tags?.length && `tags ${actions.tags.join(", ")}`,
        ]
          .filter(Boolean)
          .join("; ") || "in-app notification"}
        .
      </p>
      <Button
        size="sm"
        variant="secondary"
        className="mt-2"
        disabled={busy}
        onClick={clear}
      >
        Remove rule changes
      </Button>
      <p role="status" className="mt-2">
        {status}
      </p>
    </section>
  );
}
