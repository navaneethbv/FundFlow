import type { SinkingFundCadence } from "@/lib/insights";

const CADENCES = new Set<SinkingFundCadence>([
  "one_time",
  "annual",
  "semiannual",
  "quarterly",
  "custom",
]);

export interface SinkingFundMutation {
  name: string;
  targetAmount: number;
  dueDate: string;
  cadence: SinkingFundCadence;
  customIntervalMonths: number | null;
}

export function parseSinkingFundMutation(
  value: unknown,
): { value: SinkingFundMutation } | { error: string } {
  const body = value as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 120) {
    return { error: "name must be between 1 and 120 characters" };
  }
  if (
    typeof body?.targetAmount !== "number" ||
    !Number.isFinite(body.targetAmount) ||
    body.targetAmount <= 0
  ) {
    return { error: "targetAmount must be a positive finite number" };
  }
  if (typeof body?.dueDate !== "string" || !isIsoDate(body.dueDate)) {
    return { error: "dueDate must be a valid YYYY-MM-DD date" };
  }
  if (
    typeof body?.cadence !== "string" ||
    !CADENCES.has(body.cadence as SinkingFundCadence)
  ) {
    return { error: "cadence is not supported" };
  }

  const cadence = body.cadence as SinkingFundCadence;
  const interval = body.customIntervalMonths;
  if (
    cadence === "custom" &&
    (typeof interval !== "number" ||
      !Number.isInteger(interval) ||
      interval < 1 ||
      interval > 120)
  ) {
    return { error: "customIntervalMonths must be an integer from 1 to 120" };
  }
  if (cadence !== "custom" && interval !== undefined && interval !== null) {
    return { error: "customIntervalMonths is only valid for custom cadence" };
  }

  return {
    value: {
      name,
      targetAmount: body.targetAmount,
      dueDate: body.dueDate,
      cadence,
      customIntervalMonths:
        cadence === "custom" ? (interval as number) : null,
    },
  };
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

export const SINKING_FUND_SELECT =
  "id,name,target_amount,due_date,cadence,custom_interval_months,cycle_anchor_date";

export function sinkingFundWrite(input: SinkingFundMutation) {
  return {
    name: input.name,
    target_amount: input.targetAmount,
    due_date: input.dueDate,
    cadence: input.cadence,
    custom_interval_months: input.customIntervalMonths,
    cycle_anchor_date: input.dueDate,
  };
}
