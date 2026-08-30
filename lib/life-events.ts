/**
 * Life-event forecasting. Typed, explicit-assumption events adjust the
 * existing projection engine's monthly trajectory: the base forecast is
 * recomputed with deterministic cash deltas per event. Events are never
 * presented as guarantees — they are editable assumptions persisted only
 * through authenticated user-scoped paths.
 */

export type LifeEventType =
  | "home_purchase"
  | "child"
  | "income_change"
  | "expense_change"
  | "retirement";

export interface LifeEvent {
  id?: string;
  type: LifeEventType;
  /** 1-indexed month the event starts (1 = first projected month). */
  startMonth: number;
  /** One-off amount (home purchase) or per-month delta (child/income/expense). */
  amount: number;
  /** Months the recurring effect lasts; null = permanent. */
  durationMonths: number | null;
  label?: string | null;
}

export interface ForecastPoint {
  month: string;
  conservative: number;
  base: number;
  optimistic: number;
}

const LIFE_EVENT_TYPES = new Set<LifeEventType>([
  "home_purchase",
  "child",
  "income_change",
  "expense_change",
  "retirement",
]);

export type ParseLifeEventResult =
  | { ok: true; event: LifeEvent }
  | { ok: false; error: string };

/** Validate a raw event from an API payload. */
export function parseLifeEvent(raw: unknown): ParseLifeEventResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Life event must be an object." };
  }
  const value = raw as Record<string, unknown>;
  const type = value.type as LifeEventType;
  if (typeof type !== "string" || !LIFE_EVENT_TYPES.has(type)) {
    return { ok: false, error: "Unsupported life event type." };
  }
  const startMonth = Number(value.startMonth);
  if (!Number.isInteger(startMonth) || startMonth < 1) {
    return { ok: false, error: "startMonth must be a positive integer." };
  }
  const amount = Number(value.amount);
  if (!Number.isFinite(amount)) {
    return { ok: false, error: "amount must be a number." };
  }
  if (type === "retirement" && amount !== 0) {
    return { ok: false, error: "Retirement amount must be zero." };
  }
  if (type !== "retirement" && amount <= 0) {
    return { ok: false, error: "amount must be positive." };
  }
  const durationRaw = value.durationMonths;
  const durationMonths =
    durationRaw === null || durationRaw === undefined
      ? null
      : Number(durationRaw);
  if (durationMonths !== null && (!Number.isInteger(durationMonths) || durationMonths < 1)) {
    return { ok: false, error: "durationMonths must be null or a positive integer." };
  }
  if (
    durationMonths !== null &&
    (type === "home_purchase" || type === "retirement")
  ) {
    return {
      ok: false,
      error: "One-off home purchases and retirement cannot have a duration.",
    };
  }
  const label =
    typeof value.label === "string" && value.label.trim()
      ? value.label.trim().slice(0, 120)
      : null;
  return {
    ok: true,
    event: {
      type,
      startMonth,
      amount: Math.round(amount * 100) / 100,
      durationMonths,
      label,
    },
  };
}

/** Cumulative deterministic cash delta active at a 1-indexed month. */
function deltaAt(
  event: LifeEvent,
  month: number,
  monthlySavings: number,
): number {
  if (month < event.startMonth) return 0;
  if (event.durationMonths !== null && month >= event.startMonth + event.durationMonths) {
    return 0;
  }
  switch (event.type) {
    case "home_purchase":
      return month === event.startMonth ? -event.amount : 0;
    case "child":
      return -event.amount;
    case "income_change":
      return event.amount;
    case "expense_change":
      return -event.amount;
    case "retirement":
      // The projected monthly savings contribution stops at retirement.
      return -monthlySavings;
  }
}

/**
 * Recalculate the projection with events applied. All three scenarios shift by
 * the same deterministic cash delta (events are assumptions, not market
 * uncertainty). Without events the projection is unchanged.
 */
export function applyLifeEvents(
  points: ForecastPoint[],
  events: LifeEvent[],
  monthlySavings: number,
): ForecastPoint[] {
  if (events.length === 0) return points;
  const cumulative: number[] = [];
  let running = 0;
  for (let index = 0; index < points.length; index += 1) {
    const month = index + 1;
    const delta = events.reduce((sum, event) => sum + deltaAt(event, month, monthlySavings), 0);
    running += delta;
    cumulative.push(running);
  }
  return points.map((point, index) => ({
    ...point,
    conservative: point.conservative + cumulative[index]!,
    base: point.base + cumulative[index]!,
    optimistic: point.optimistic + cumulative[index]!,
  }));
}
