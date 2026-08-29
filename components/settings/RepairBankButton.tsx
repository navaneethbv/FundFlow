"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import ReconnectBankButton from "@/components/settings/ReconnectBankButton";
import { runItemRepair } from "@/lib/repair";

type RepairPhase = "idle" | "running" | "bounded" | "done" | "needs_action" | "error";

/**
 * Authenticated repair control for one Plaid item. Posts to /api/plaid/repair
 * and renders loading, success, bounded-backfill, provider-conditional
 * (consent/login), and error states with a retry action.
 */
export default function RepairBankButton({
  itemId,
}: Readonly<{ itemId: string }>) {
  const [phase, setPhase] = useState<RepairPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function runRepair() {
    setPhase("running");
    setMessage(null);
    const state = await runItemRepair(itemId);
    setMessage(state.message);
    if (state.kind === "success") setPhase("done");
    else if (state.kind === "backfill_incomplete") setPhase("bounded");
    else if (state.kind === "needs_consent" || state.kind === "needs_login") {
      setPhase("needs_action");
    } else setPhase("error");
  }

  const needsReconnect = phase === "needs_action";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {needsReconnect ? (
        <ReconnectBankButton itemId={itemId} />
      ) : (
        <Button
          onClick={() => void runRepair()}
          disabled={phase === "running"}
          variant="secondary"
          size="sm"
        >
          {phase === "running" ? "Repairing..." : phase === "done" ? "Repaired" : "Repair"}
        </Button>
      )}
      {message && (
        <output className="block max-w-xs text-xs text-muted">{message}</output>
      )}
    </span>
  );
}