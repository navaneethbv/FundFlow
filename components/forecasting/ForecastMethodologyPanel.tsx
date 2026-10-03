import Panel from "@/components/ui/Panel";
import { FIRE_WITHDRAWAL_RATE, SCENARIO_SPREAD_PCT } from "@/lib/forecasting";

/**
 * The disclosure uses the same exported constants as the projection engine.
 * Keeping the explanation beside the math makes a copy change fail loudly in
 * review instead of silently drifting from the numbers the page renders.
 */
export default function ForecastMethodologyPanel({
  monthlyExpenses,
  earmarkedCapital,
}: Readonly<{ monthlyExpenses: number; earmarkedCapital: number }>) {
  return (
    <Panel title="How this is calculated" eyebrow="Projection method">
      <details>
        <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-2">
          See the assumptions behind these numbers
        </summary>
        <div className="mt-3 space-y-2 text-sm text-muted">
          <p>
            Cash compounds at the cash-yield input, investments compound at the
            investment-return input, and monthly savings and debt payments are
            applied before the next month.
          </p>
          <p>
            The default scenarios differ by {SCENARIO_SPREAD_PCT} percentage points
            around your entered investment return. They are projections, not
            predictions or confidence intervals.
          </p>
          <p>
            FIRE uses the {Math.round(FIRE_WITHDRAWAL_RATE * 100)}% withdrawal-rate
            planning rule ({Math.round(1 / FIRE_WITHDRAWAL_RATE)}× annual expenses).
            {monthlyExpenses > 0
              ? ` The current expense baseline is $${monthlyExpenses.toLocaleString()} per month.`
              : " There is not yet enough expense history for an expense baseline."}
          </p>
          <p>
            {earmarkedCapital > 0
              ? `$${earmarkedCapital.toLocaleString()} of funded emergency or sinking-style goals is shown separately and excluded from FIRE capital.`
              : "No funded emergency or sinking-style goal balance is currently earmarked."}
          </p>
        </div>
      </details>
    </Panel>
  );
}
