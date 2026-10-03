import { isoDate, parseDate } from "@/lib/date-utils";

export interface ConstituentWeight {
  key: string;
  name: string;
  sector: string;
  region: string;
  weight: number;
}

export interface LookthroughRecord {
  holdingId: string;
  version: number;
  weights: ConstituentWeight[];
  source: "manual";
  asOfDate: string;
}

export interface LookthroughHolding {
  id: string;
  securityName: string;
  ticker: string | null;
  securityType: string | null;
  value: number | null;
}

export interface LookthroughExposure {
  key: string;
  name: string;
  value: number;
  weightPct: number;
  holdingIds: string[];
  contributors: Array<{ holdingId: string; holdingName: string; value: number }>;
}

export interface LookthroughSummary {
  totalValue: number;
  coveredValue: number;
  unknownValue: number;
  coveragePct: number | null;
  asOfDate: string | null;
  bySecurity: LookthroughExposure[];
  bySector: LookthroughExposure[];
  byRegion: LookthroughExposure[];
  configuredHoldingCount: number;
  unknownHoldingCount: number;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EPSILON = 0.0001;

function validDate(value: string): boolean {
  return DATE_RE.test(value) && isoDate(parseDate(value)) === value;
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

type ConstituentParse = { ok: true; weight: ConstituentWeight } | { ok: false; error: string };

function parseConstituentEntry(entry: unknown, seen: Set<string>): ConstituentParse {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, error: "Each constituent must be an object." };
  }
  const row = entry as Record<string, unknown>;
  const key = typeof row.key === "string" ? row.key.trim() : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const sector = typeof row.sector === "string" ? row.sector.trim() : "Unknown";
  const region = typeof row.region === "string" ? row.region.trim() : "Unknown";
  const weight = row.weight;
  if (!KEY_RE.test(key) || !text(name, 120) || !text(sector, 80) || !text(region, 80)) {
    return { ok: false, error: "Each constituent needs a stable key, name, sector, and region." };
  }
  if (seen.has(key)) return { ok: false, error: `Constituent key ${key} is duplicated.` };
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1) {
    return { ok: false, error: "Weights must be numbers between 0 and 1." };
  }
  return { ok: true, weight: { key, name, sector, region, weight } };
}

export function parseConstituentWeights(value: unknown):
  | { ok: true; weights: ConstituentWeight[] }
  | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return { ok: false, error: "Add between 1 and 100 constituent weights." };
  }
  const seen = new Set<string>();
  const weights: ConstituentWeight[] = [];
  for (const entry of value) {
    const parsed = parseConstituentEntry(entry, seen);
    if (!parsed.ok) return parsed;
    seen.add(parsed.weight.key);
    weights.push(parsed.weight);
  }
  const total = weights.reduce((sum, row) => sum + row.weight, 0);
  if (Math.abs(total - 1) > EPSILON) {
    return { ok: false, error: `Weights must add to 100%; they currently add to ${(total * 100).toFixed(2)}%.` };
  }
  return { ok: true, weights };
}

export function parseLookthroughData(value: unknown):
  | { ok: true; weights: ConstituentWeight[]; asOfDate: string }
  | { ok: false; error: string } {
  if (value === null) return { ok: false, error: "Look-through data is required." };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Enter look-through data." };
  const data = value as Record<string, unknown>;
  const asOfDate = typeof data.asOfDate === "string" ? data.asOfDate : "";
  if (!validDate(asOfDate)) return { ok: false, error: "asOfDate must be a valid YYYY-MM-DD date." };
  // This is an explicit UTC capture boundary, not a viewer-relative date.
  const today = isoDate(new Date());
  if (asOfDate > today) return { ok: false, error: "asOfDate cannot be in the future." };
  const parsed = parseConstituentWeights(data.weights);
  return parsed.ok ? { ok: true, weights: parsed.weights, asOfDate } : parsed;
}

function directWeight(holding: LookthroughHolding): ConstituentWeight[] | null {
  const ticker = holding.ticker?.trim().toUpperCase();
  const type = holding.securityType?.toLowerCase();
  if (!ticker || type === "etf" || type === "mutual fund") return null;
  return [{ key: `ticker:${ticker}`, name: holding.securityName, sector: "Unknown", region: "Unknown", weight: 1 }];
}

function addExposure(
  map: Map<string, LookthroughExposure>,
  key: string,
  name: string,
  value: number,
  holding: LookthroughHolding,
): void {
  const existing = map.get(key);
  if (existing) {
    existing.value = Math.round((existing.value + value + Number.EPSILON) * 100) / 100;
    if (!existing.holdingIds.includes(holding.id)) existing.holdingIds.push(holding.id);
    existing.contributors.push({ holdingId: holding.id, holdingName: holding.securityName, value });
    return;
  }
  map.set(key, {
    key,
    name,
    value: Math.round((value + Number.EPSILON) * 100) / 100,
    weightPct: 0,
    holdingIds: [holding.id],
    contributors: [{ holdingId: holding.id, holdingName: holding.securityName, value }],
  });
}

function finishExposure(map: Map<string, LookthroughExposure>, total: number): LookthroughExposure[] {
  return [...map.values()]
    .map((row) => ({ ...row, weightPct: total > 0 ? Math.round((row.value / total) * 10000) / 100 : 0 }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

interface HoldingContribution {
  value: number;
  coveredValue: number;
  unknownValue: number;
  configured: boolean;
  unknownHolding: boolean;
  asOfDate: string | null;
}

function summarizeHolding(
  holding: LookthroughHolding,
  recordByHolding: Map<string, LookthroughRecord>,
  security: Map<string, LookthroughExposure>,
  sector: Map<string, LookthroughExposure>,
  region: Map<string, LookthroughExposure>,
): HoldingContribution | null {
  const value = holding.value;
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const stored = recordByHolding.get(holding.id);
  const weights = stored?.weights ?? directWeight(holding);
  if (!weights) return { value, coveredValue: 0, unknownValue: value, configured: Boolean(stored), unknownHolding: true, asOfDate: stored?.asOfDate ?? null };
  let coveredValue = 0;
  let unknownValue = 0;
  for (const weight of weights) {
    const exposure = value * weight.weight;
    if (weight.key === "unknown" || weight.key.startsWith("unknown:")) unknownValue += exposure;
    else coveredValue += exposure;
    addExposure(security, weight.key, weight.name, exposure, holding);
    addExposure(sector, `sector:${weight.sector}`, weight.sector, exposure, holding);
    addExposure(region, `region:${weight.region}`, weight.region, exposure, holding);
  }
  return { value, coveredValue, unknownValue, configured: Boolean(stored), unknownHolding: false, asOfDate: stored?.asOfDate ?? null };
}

function summaryAsOfDate(dates: Set<string>): string | null {
  if (dates.size === 1) return dates.values().next().value ?? null;
  if (dates.size > 1) return "Mixed";
  return null;
}

export function buildLookthroughSummary(
  holdings: readonly LookthroughHolding[],
  records: readonly LookthroughRecord[],
): LookthroughSummary {
  const recordByHolding = new Map(records.map((record) => [record.holdingId, record]));
  const security = new Map<string, LookthroughExposure>();
  const sector = new Map<string, LookthroughExposure>();
  const region = new Map<string, LookthroughExposure>();
  let totalValue = 0;
  let coveredValue = 0;
  let unknownValue = 0;
  let configuredHoldingCount = 0;
  let unknownHoldingCount = 0;
  const dates = new Set<string>();

  for (const holding of holdings) {
    const contribution = summarizeHolding(holding, recordByHolding, security, sector, region);
    if (!contribution) continue;
    totalValue += contribution.value;
    coveredValue += contribution.coveredValue;
    unknownValue += contribution.unknownValue;
    if (contribution.configured) configuredHoldingCount += 1;
    if (contribution.unknownHolding) unknownHoldingCount += 1;
    if (contribution.asOfDate) dates.add(contribution.asOfDate);
  }
  const roundedTotal = Math.round((totalValue + Number.EPSILON) * 100) / 100;
  const roundedCovered = Math.round((coveredValue + Number.EPSILON) * 100) / 100;
  const roundedUnknown = Math.round((unknownValue + Number.EPSILON) * 100) / 100;
  return {
    totalValue: roundedTotal,
    coveredValue: roundedCovered,
    unknownValue: roundedUnknown,
    coveragePct: roundedTotal > 0 ? Math.round((roundedCovered / roundedTotal) * 10000) / 100 : null,
    asOfDate: summaryAsOfDate(dates),
    bySecurity: finishExposure(security, roundedTotal),
    bySector: finishExposure(sector, roundedTotal),
    byRegion: finishExposure(region, roundedTotal),
    configuredHoldingCount,
    unknownHoldingCount,
  };
}
