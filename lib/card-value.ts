import { TRANSFER_GROUPS } from "@/lib/finance-domain";

export interface RewardTier {
  id: string;
  label: string;
  rate: number;
  cap: number | null;
  eligibleCategories: string[];
}

export interface StatementCredit {
  id: string;
  label: string;
  amount: number;
  eligibleCategories: string[];
  expiresAfterMonths: number | null;
}

export interface SubjectivePerk {
  id: string;
  label: string;
  low: number;
  base: number;
  high: number;
  membershipOnly: boolean;
}

export interface CardValueTerms {
  id: string;
  membershipName: string;
  cardName: string;
  annualFee: number;
  baselineAnnualFee: number;
  anniversaryDate: string;
  confirmedOn: string;
  rewardTiers: RewardTier[];
  statementCredits: StatementCredit[];
  perks: SubjectivePerk[];
}

export interface CardValueSpendRow {
  date: string;
  amount: number;
  category: string | null;
  flow: "expense" | "income" | "transfer";
  /** A linked refund keeps its negative amount so it nets the purchase. */
  isRefund?: boolean;
}

export interface CardValueResult {
  anniversaryStart: string;
  anniversaryEnd: string;
  historyCoverage: number;
  eligibleSpend: number;
  measuredRewards: number;
  projectedRewards: number;
  statementCredits: number;
  subjectivePerks: { low: number; base: number; high: number };
  cardAdvantage: { low: number; base: number; high: number };
  membershipValue: { low: number; base: number; high: number };
  totalValue: { low: number; base: number; high: number };
  breakEvenSpend: number | null;
  termsStale: boolean;
}

export interface CardValueInput {
  terms: CardValueTerms;
  spend: CardValueSpendRow[];
  asOf: string;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function anniversaryInYear(monthDay: string, year: number): string {
  const [month, day] = monthDay.slice(5).split("-").map(Number);
  const safeDay = Math.min(day!, daysInMonth(year, month!));
  return `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

export function anniversaryWindow(anniversaryDate: string, asOf: string): { start: string; end: string } {
  if (!validDate(anniversaryDate) || !validDate(asOf)) throw new Error("anniversary dates must be ISO dates");
  const year = Number(asOf.slice(0, 4));
  let start = anniversaryInYear(anniversaryDate, year);
  if (start > asOf) start = anniversaryInYear(anniversaryDate, year - 1);
  const nextYear = Number(start.slice(0, 4)) + 1;
  const end = anniversaryInYear(anniversaryDate, nextYear);
  return { start, end };
}

function categoryMatches(categories: string[], category: string | null): boolean {
  if (categories.length === 0) return true;
  const normalized = (category ?? "").trim().toUpperCase();
  return categories.some((entry) => entry.trim().toUpperCase() === normalized);
}

function rewardForSpend(spend: number, tiers: RewardTier[]): number {
  let remaining = Math.max(0, spend);
  let result = 0;
  for (const tier of tiers) {
    const eligible = Math.min(remaining, tier.cap ?? remaining);
    result += eligible * Math.max(0, tier.rate);
    remaining -= eligible;
    if (remaining <= 0) break;
  }
  return round2(result);
}

function eligibleSpendForTier(rows: CardValueSpendRow[], tier: RewardTier): number {
  return rows
    .filter((row) => row.flow === "expense" && !TRANSFER_GROUPS.has((row.category ?? "").toUpperCase()) && categoryMatches(tier.eligibleCategories, row.category))
    .reduce((sum, row) => sum + row.amount, 0);
}

function creditTotal(
  rows: CardValueSpendRow[],
  credits: StatementCredit[],
  anniversaryStart: string,
  asOf: string,
): number {
  const elapsedMonths = Math.max(
    0,
    (Number(asOf.slice(0, 4)) - Number(anniversaryStart.slice(0, 4))) * 12
      + Number(asOf.slice(5, 7)) - Number(anniversaryStart.slice(5, 7)),
  );
  return round2(credits.reduce((sum, credit) => {
    const qualifies = rows.some((row) => row.flow === "expense" && !TRANSFER_GROUPS.has((row.category ?? "").toUpperCase()) && categoryMatches(credit.eligibleCategories, row.category));
    const active = credit.expiresAfterMonths === null || elapsedMonths <= credit.expiresAfterMonths;
    return sum + (qualifies && active ? Math.max(0, credit.amount) : 0);
  }, 0));
}

function rewardTotal(rows: CardValueSpendRow[], tiers: RewardTier[]): number {
  return round2(tiers.reduce((sum, tier) => sum + rewardForSpend(eligibleSpendForTier(rows, tier), [tier]), 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function calculateCardValue({ terms, spend, asOf }: CardValueInput): CardValueResult {
  const window = anniversaryWindow(terms.anniversaryDate, asOf);
  const rows = spend.filter((row) => row.date >= window.start && row.date < window.end);
  const eligibleRows = rows.filter((row) => row.flow === "expense" && !TRANSFER_GROUPS.has((row.category ?? "").toUpperCase()));
  const eligibleSpend = round2(eligibleRows.reduce((sum, row) => sum + row.amount, 0));
  const observedDates = eligibleRows.map((row) => row.date).sort();
  const windowDays = Math.max(1, Math.round((Date.parse(`${window.end}T12:00:00Z`) - Date.parse(`${window.start}T12:00:00Z`)) / 86_400_000));
  const observedDays = observedDates.length === 0 ? 0 : Math.max(1, Math.round((Date.parse(`${observedDates.at(-1)}T12:00:00Z`) - Date.parse(`${observedDates[0]}T12:00:00Z`)) / 86_400_000) + 1);
  const historyCoverage = clamp(round2(observedDays / windowDays), 0, 1);
  const measuredRewards = rewardTotal(eligibleRows, terms.rewardTiers);
  const projectedRewards = historyCoverage >= 0.99 ? 0 : round2(rewardTotal(eligibleRows, terms.rewardTiers) / Math.max(historyCoverage, 0.01) - measuredRewards);
  const statementCredits = creditTotal(eligibleRows, terms.statementCredits, window.start, asOf);
  const subjectivePerks = {
    low: round2(terms.perks.reduce((sum, perk) => sum + Math.max(0, perk.low), 0)),
    base: round2(terms.perks.reduce((sum, perk) => sum + Math.max(0, perk.base), 0)),
    high: round2(terms.perks.reduce((sum, perk) => sum + Math.max(0, perk.high), 0)),
  };
  const rewardBase = round2(measuredRewards + projectedRewards + statementCredits);
  const cardAdvantage = {
    low: round2(rewardBase - Math.max(0, terms.baselineAnnualFee)),
    base: round2(rewardBase - Math.max(0, terms.baselineAnnualFee)),
    high: round2(rewardBase - Math.max(0, terms.baselineAnnualFee)),
  };
  const membershipDelta = round2(Math.max(0, terms.baselineAnnualFee) - Math.max(0, terms.annualFee));
  const membershipValue = {
    low: round2(membershipDelta + subjectivePerks.low),
    base: round2(membershipDelta + subjectivePerks.base),
    high: round2(membershipDelta + subjectivePerks.high),
  };
  const totalValue = {
    low: round2(cardAdvantage.low + membershipValue.low),
    base: round2(cardAdvantage.base + membershipValue.base),
    high: round2(cardAdvantage.high + membershipValue.high),
  };
  const baseRate = terms.rewardTiers.reduce((sum, tier) => sum + Math.max(0, tier.rate), 0);
  const fixedBenefits = statementCredits + subjectivePerks.base + Math.max(0, terms.baselineAnnualFee);
  const breakEvenSpend = baseRate > 0 ? round2(Math.max(0, terms.annualFee - fixedBenefits) / baseRate) : null;
  const termsStale = Date.parse(`${asOf}T12:00:00Z`) - Date.parse(`${terms.confirmedOn}T12:00:00Z`) > 366 * 86_400_000;
  return {
    anniversaryStart: window.start,
    anniversaryEnd: window.end,
    historyCoverage,
    eligibleSpend,
    measuredRewards,
    projectedRewards,
    statementCredits,
    subjectivePerks,
    cardAdvantage,
    membershipValue,
    totalValue,
    breakEvenSpend,
    termsStale,
  };
}

export function validateCardValueTerms(value: unknown): { ok: true; value: CardValueTerms[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length > 50) return { ok: false, error: "terms must be an array of at most 50 cards" };
  const terms: CardValueTerms[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "invalid card terms" };
    const row = item as Partial<CardValueTerms>;
    if (typeof row.id !== "string" || row.id.trim().length === 0 || typeof row.membershipName !== "string" || row.membershipName.trim().length === 0 || typeof row.cardName !== "string" || row.cardName.trim().length === 0 || !validDate(row.anniversaryDate ?? "") || !validDate(row.confirmedOn ?? "")) return { ok: false, error: "invalid card identity or dates" };
    if (![row.annualFee, row.baselineAnnualFee].every((amount) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0)) return { ok: false, error: "invalid card fee" };
    if (!Array.isArray(row.rewardTiers) || !Array.isArray(row.statementCredits) || !Array.isArray(row.perks)) return { ok: false, error: "invalid card benefit lists" };
    const rewardTiers = row.rewardTiers.slice(0, 20).map((tier) => {
      if (!tier || typeof tier !== "object") return null;
      const candidate = tier as Partial<RewardTier>;
      if (typeof candidate.id !== "string" || candidate.id.trim().length === 0 || typeof candidate.label !== "string" || candidate.label.trim().length === 0 || typeof candidate.rate !== "number" || !Number.isFinite(candidate.rate) || candidate.rate < 0 || candidate.rate > 1 || (candidate.cap !== null && typeof candidate.cap !== "number")) return null;
      return { id: candidate.id.slice(0, 80), label: candidate.label.trim().slice(0, 120), rate: candidate.rate, cap: candidate.cap ?? null, eligibleCategories: Array.isArray(candidate.eligibleCategories) ? candidate.eligibleCategories.filter((entry): entry is string => typeof entry === "string").slice(0, 30) : [] };
    });
    if (rewardTiers.some((tier) => tier === null)) return { ok: false, error: "invalid reward tier" };
    const statementCredits = row.statementCredits.slice(0, 20).map((credit) => {
      if (!credit || typeof credit !== "object") return null;
      const candidate = credit as Partial<StatementCredit>;
      if (typeof candidate.id !== "string" || candidate.id.trim().length === 0 || typeof candidate.label !== "string" || candidate.label.trim().length === 0 || typeof candidate.amount !== "number" || !Number.isFinite(candidate.amount) || candidate.amount < 0) return null;
      return { id: candidate.id.slice(0, 80), label: candidate.label.trim().slice(0, 120), amount: candidate.amount, eligibleCategories: Array.isArray(candidate.eligibleCategories) ? candidate.eligibleCategories.filter((entry): entry is string => typeof entry === "string").slice(0, 30) : [], expiresAfterMonths: typeof candidate.expiresAfterMonths === "number" ? Math.max(0, Math.floor(candidate.expiresAfterMonths)) : null };
    });
    if (statementCredits.some((credit) => credit === null)) return { ok: false, error: "invalid statement credit" };
    const perks = row.perks.slice(0, 20).map((perk) => {
      if (!perk || typeof perk !== "object") return null;
      const candidate = perk as Partial<SubjectivePerk>;
      if (typeof candidate.id !== "string" || candidate.id.trim().length === 0 || typeof candidate.label !== "string" || candidate.label.trim().length === 0 || ![candidate.low, candidate.base, candidate.high].every((amount) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0)) return null;
      return { id: candidate.id.slice(0, 80), label: candidate.label.trim().slice(0, 120), low: candidate.low!, base: candidate.base!, high: candidate.high!, membershipOnly: candidate.membershipOnly === true };
    });
    if (perks.some((perk) => perk === null)) return { ok: false, error: "invalid subjective perk" };
    terms.push({
      id: row.id.slice(0, 80), membershipName: row.membershipName.trim().slice(0, 120), cardName: row.cardName.trim().slice(0, 120), annualFee: row.annualFee!, baselineAnnualFee: row.baselineAnnualFee!, anniversaryDate: row.anniversaryDate!, confirmedOn: row.confirmedOn!, rewardTiers: rewardTiers as RewardTier[], statementCredits: statementCredits as StatementCredit[], perks: perks as SubjectivePerk[],
    });
  }
  return { ok: true, value: terms };
}
