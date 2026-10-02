"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import { BALANCE_QUALITY_LABELS } from "@/lib/balance-quality";
import type { BalanceReview } from "@/lib/balance-quality-data";

function balance(value: number | null, currency: string) {
  return value === null ? "Unknown" : formatCurrency(value, currency);
}
function ReviewCard({
  review,
  accountName,
}: Readonly<{ review: BalanceReview; accountName: string }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [decision, setDecision] = useState(review.decision);
  async function resolve(next: "accepted" | "carried") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/accounts/balance-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewId: review.id,
          version: review.version,
          decision: next,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to save decision");
      setDecision(next);
      setNotice("Decision saved. The provider observation is preserved.");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save decision",
      );
    } finally {
      setBusy(false);
    }
  }
  const canDecide = decision === "pending" && review.superseded_at === null;
  return (
    <Panel>
      <h2 className="font-semibold">{accountName}</h2>
      <p className="text-sm text-muted">
        Observation: {formatDate(review.snapshot_date)}
      </p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">Raw provider value</dt>
          <dd data-money className="font-semibold tabular-nums">
            {balance(review.raw_balance, review.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">
            Last reliable value
            {review.anchor_date ? ` (${formatDate(review.anchor_date)})` : ""}
          </dt>
          <dd data-money className="font-semibold tabular-nums">
            {balance(review.anchor_balance, review.currency)}
          </dd>
        </div>
      </dl>
      <ul className="mt-3 list-disc pl-5 text-sm">
        {review.reasons.map((reason) => (
          <li key={reason}>{BALANCE_QUALITY_LABELS[reason]}</li>
        ))}
      </ul>
      {review.superseded_at ? (
        <p className="mt-3 text-sm text-muted">
          Superseded by a newer observation.
        </p>
      ) : (
        <p data-money className="mt-3 text-sm font-semibold">
          {decision === "carried"
            ? `Stale history value: ${balance(review.anchor_balance, review.currency)} from ${formatDate(review.anchor_date!)}`
            : decision === "accepted"
              ? "Accepted provider observation"
              : "Needs your review"}
        </p>
      )}
      {canDecide && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void resolve("accepted")}>
            Accept provider value
          </Button>
          <Button
            variant="secondary"
            disabled={busy || review.anchor_balance === null}
            onClick={() => void resolve("carried")}
          >
            Keep previous in history
          </Button>
        </div>
      )}
      <p role="status" aria-live="polite" className="mt-2 text-sm">
        {notice}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}{" "}
          <Button variant="ghost" size="sm" onClick={() => router.refresh()}>
            Reload reviews
          </Button>
        </p>
      )}
    </Panel>
  );
}
export default function BalanceReviewQueue({
  reviews,
  accounts,
}: Readonly<{ reviews: BalanceReview[]; accounts: Record<string, string> }>) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        These are review signals, not corrections. Genuine deposits,
        withdrawals, and market changes can trigger them. Keeping a previous
        value changes history presentation only; current bank balances stay as
        reported.
      </p>
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2">
          How reviews are selected
        </summary>
        <p>
          We compare same-currency observations within seven days. A balance
          change must be at least 1,000 currency units and 100% of the prior
          balance. We also review missing balances, newly empty holdings, and
          unit-price changes of at least 50% on prior positions worth 1,000 or
          more, excluding near-unchanged position values.
        </p>
      </details>
      {reviews.length === 0 && (
        <Panel>
          <p>No balance reviews to show.</p>
        </Panel>
      )}
      {reviews.map((review) => (
        <ReviewCard
          key={`${review.id}:${review.version}`}
          review={review}
          accountName={accounts[review.account_id] ?? "Bank account"}
        />
      ))}
    </div>
  );
}
