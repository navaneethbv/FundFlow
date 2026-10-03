import { isoDate, parseDate } from "@/lib/date-utils";

export interface AssetInput {
  id?: string;
  version?: number;
  name: string;
  assetKind: "property" | "vehicle" | "other";
  value: number;
  valuationDate: string;
  valueSource: string;
  ownershipPercentage: number;
  purchasePrice: number | null;
  purchaseDate: string | null;
  growth: { kind: "percent" | "absolute"; amount: number; period: "month" | "year"; startDate: string | null } | null;
}

function money(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e12
    && Number(value.toFixed(2)) === value;
}

function date(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)
    && isoDate(parseDate(value)) === value;
}

function validateValuation(body: Record<string, unknown>, today: string): string | null {
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) return "Enter a name of up to 120 characters.";
  if (!["property", "vehicle", "other"].includes(String(body.assetKind))) return "Choose an asset kind.";
  if (!money(body.value)) return "Enter a nonnegative value with at most two decimals.";
  if (!date(body.valuationDate) || body.valuationDate > today || Number(today.slice(0, 4)) - Number(body.valuationDate.slice(0, 4)) > 100) return "Choose a valuation date within the past 100 years.";
  if (typeof body.valueSource !== "string" || !body.valueSource.trim() || body.valueSource.trim().length > 120) return "Describe the valuation source in up to 120 characters.";
  if (!money(body.ownershipPercentage) || body.ownershipPercentage <= 0 || body.ownershipPercentage > 100) return "Ownership must be greater than zero and at most 100 percent.";
  return null;
}

function validatePurchase(body: Record<string, unknown>): string | null {
  if (body.purchasePrice != null && !money(body.purchasePrice)) return "Enter a valid purchase price.";
  if (body.purchaseDate != null && (!date(body.purchaseDate) || body.purchaseDate > String(body.valuationDate))) return "Purchase date must be on or before the valuation date.";
  return null;
}

function validateIdentity(body: Record<string, unknown>): string | null {
  if (body.id !== undefined && (typeof body.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)
    || !Number.isSafeInteger(body.version) || Number(body.version) < 1 || Number(body.version) >= 2147483647)) return "Reload the asset before saving.";
  return null;
}

function parseGrowth(value: unknown): AssetInput["growth"] | string {
    if (value == null) return null;
    if (typeof value !== "object" || Array.isArray(value)) return "Choose valid growth assumptions.";
    const g = value as Record<string, unknown>;
    if ((g.kind !== "percent" && g.kind !== "absolute") || (g.period !== "month" && g.period !== "year")
      || typeof g.amount !== "number" || !money(Math.abs(g.amount)) || (g.kind === "percent" && (g.amount < -100 || g.amount > 100))) return "Choose valid growth assumptions.";
    if (g.startDate != null && !date(g.startDate)) return "Choose a valid growth start date.";
    return { kind: g.kind, amount: g.amount, period: g.period, startDate: g.startDate as string | null ?? null };
}

export function parseAssetInput(value: unknown, today: string): AssetInput | string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Enter asset details.";
  const candidate = value as Record<string, unknown>;
  const error = validateValuation(candidate, today) ?? validatePurchase(candidate) ?? validateIdentity(candidate);
  if (error) return error;
  const growth = parseGrowth(candidate.growth);
  if (typeof growth === "string") return growth;
  const body = candidate as unknown as AssetInput;
  return {
    ...(body.id === undefined ? {} : { id: body.id as string, version: body.version as number }),
    name: body.name.trim(), assetKind: body.assetKind as AssetInput["assetKind"], value: body.value,
    valuationDate: body.valuationDate, valueSource: body.valueSource.trim(), ownershipPercentage: body.ownershipPercentage,
    purchasePrice: body.purchasePrice as number | null ?? null, purchaseDate: body.purchaseDate as string | null ?? null, growth,
  };
}
