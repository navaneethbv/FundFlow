"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Panel from "@/components/ui/Panel";
import {
  paydayDates,
  type PaydaySettings,
  type PaydayCadence,
} from "@/lib/payday";
import type { Paycheck } from "@/lib/insights";
import { formatCurrency } from "@/lib/format";
export default function PaydaySettingsForm({
  stored,
  suggested,
  today,
}: Readonly<{
  stored: PaydaySettings | null;
  suggested: Paycheck | null;
  today: string;
}>) {
  const router = useRouter();
  const [cadence, setCadence] = useState<PaydayCadence>(
    stored?.cadence ?? "biweekly",
  );
  const [anchorDate, setAnchorDate] = useState(
    stored ? paydayDates(stored, today, 1)[0]! : today,
  );
  const [amount, setAmount] = useState(stored ? String(stored.amount) : "");
  const [day1, setDay1] = useState(
    String(stored?.day1 ?? Number(today.slice(8, 10))),
  );
  const [day2, setDay2] = useState(String(stored?.day2 ?? 15));
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [saved, setSaved] = useState(stored !== null);
  async function save(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/settings/payday", {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST"
          ? {
              body: JSON.stringify({
                cadence,
                anchorDate,
                amount: Number(amount),
                day1: Number(day1),
                day2: cadence === "semimonthly" ? Number(day2) : null,
              }),
            }
          : {}),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to save payday");
      setSaved(method === "POST");
      setMessage(
        method === "POST"
          ? "Payday confirmed. Your schedule now drives payday guidance."
          : "Payday cleared. Detected income remains a suggestion only.",
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save payday",
      );
    } finally {
      setBusy(false);
    }
  }
  function useSuggestion() {
    if (
      !suggested?.nextPayDate ||
      !["weekly", "biweekly", "monthly"].includes(suggested.frequency)
    )
      return;
    setCadence(suggested.frequency as PaydayCadence);
    setAnchorDate(suggested.nextPayDate);
    setAmount(String(Math.abs(suggested.amount)));
    setDay1(String(Number(suggested.nextPayDate.slice(8, 10))));
    setMessage(
      "Suggestion copied into the form. Review and confirm it to change your schedule.",
    );
  }
  return (
    <Panel title="Confirm your payday">
      <p className="text-sm text-muted">
        This is your expected take-home amount in USD. Bank-detected income does
        not set a payday until you confirm it. Dates follow your profile
        timezone.
      </p>
      {suggested?.nextPayDate && (
        <div className="my-4 rounded-card border border-panel-border p-3">
          <p data-money className="text-sm">
            Detected suggestion: {suggested.name},{" "}
            {formatCurrency(suggested.amount)}, {suggested.frequency}, next{" "}
            {suggested.nextPayDate}.
          </p>
          {["weekly", "biweekly", "monthly"].includes(suggested.frequency) && (
            <Button disabled={busy} variant="secondary" onClick={useSuggestion}>
              Use suggestion in form
            </Button>
          )}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save("POST");
        }}
        className="mt-4 grid gap-4 sm:grid-cols-2"
      >
        <label className="grid gap-1 text-sm">
          Pay cadence
          <Select
            value={cadence}
            disabled={busy}
            onChange={(event) =>
              setCadence(event.target.value as PaydayCadence)
            }
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every two weeks</option>
            <option value="semimonthly">Twice a month</option>
            <option value="monthly">Monthly</option>
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          Next payday
          <Input
            type="date"
            required
            value={anchorDate}
            min={today}
            disabled={busy}
            onChange={(event) => {
              setAnchorDate(event.target.value);
              setDay1(String(Number(event.target.value.slice(8, 10))));
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Expected take-home pay (USD)
          <Input
            data-money
            type="number"
            required
            min="0.01"
            max="10000000"
            step="0.01"
            value={amount}
            disabled={busy}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        {(cadence === "monthly" || cadence === "semimonthly") && (
          <label className="grid gap-1 text-sm">
            Payday of month
            <Input
              type="number"
              min="1"
              max="31"
              required
              value={day1}
              disabled={busy}
              onChange={(event) => setDay1(event.target.value)}
            />
          </label>
        )}
        {cadence === "semimonthly" && (
          <label className="grid gap-1 text-sm">
            Second payday of month
            <Input
              type="number"
              min="1"
              max="31"
              required
              value={day2}
              disabled={busy}
              onChange={(event) => setDay2(event.target.value)}
            />
          </label>
        )}
        <p className="text-xs text-muted sm:col-span-2">
          Days beyond a month’s end use its last day. Weekend and holiday shifts
          are not assumed.
        </p>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy}>
            Confirm payday
          </Button>
          {saved && (
            <Button
              disabled={busy}
              variant="secondary"
              onClick={() => void save("DELETE")}
            >
              Clear confirmed payday
            </Button>
          )}
        </div>
      </form>
      <p role="status" aria-live="polite" className="mt-3 text-sm">
        {message}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Panel>
  );
}
