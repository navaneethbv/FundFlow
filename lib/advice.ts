import { ALLOWED_SOURCE_HOSTS, type AdviceContext, type AdviceItem } from "@/lib/advice-content";

export type { AdviceContext, AdviceItem, AdviceCategory, AdviceSource, AdviceTask } from "@/lib/advice-content";

export interface AdviceProgressRow {
  advice_id: string;
  task_id: string;
}

export interface AdviceItemProgress {
  done: number;
  total: number;
}

function progressFor(item: AdviceItem, progress: AdviceProgressRow[]): AdviceItemProgress {
  const validTaskIds = new Set(item.tasks.map((t) => t.id));
  const done = new Set(
    progress
      .filter((p) => p.advice_id === item.id && validTaskIds.has(p.task_id))
      .map((p) => p.task_id),
  ).size;
  return { done, total: item.tasks.length };
}

export interface AdviceView {
  prioritized: (AdviceItem & AdviceItemProgress & { started: boolean })[];
  essential: (AdviceItem & AdviceItemProgress)[];
  completedCount: number;
}

/**
 * Splits the library into two sections. "Prioritized by you" honors the
 * user's saved order verbatim (a user who explicitly chose an item wants to
 * see it, whether or not its relevantWhen still matches — priorities are a
 * decision, not a suggestion); with no saved priorities it falls back to
 * whichever relevant items aren't finished yet, in library order. "Essential"
 * is the always-relevant baseline (no relevantWhen predicate), minus
 * whatever is already showing in Prioritized.
 */
export function buildAdviceView(
  library: AdviceItem[],
  progress: AdviceProgressRow[],
  priorities: string[] | null,
  ctx: AdviceContext,
): AdviceView {
  const byId = new Map(library.map((item) => [item.id, item]));
  const isRelevant = (item: AdviceItem) => !item.relevantWhen || item.relevantWhen(ctx);

  let prioritized: (AdviceItem & AdviceItemProgress & { started: boolean })[];
  if (priorities && priorities.length > 0) {
    prioritized = priorities
      .map((id) => byId.get(id))
      .filter((item): item is AdviceItem => item !== undefined)
      .map((item) => {
        const p = progressFor(item, progress);
        return { ...item, ...p, started: p.done > 0 };
      });
  } else {
    // Default fallback only draws from contextually-triggered items — a
    // universal item with no relevantWhen belongs in Essential, not here,
    // or every item would show up in both sections at once.
    prioritized = library
      .filter((item) => item.relevantWhen && isRelevant(item))
      .map((item) => ({ item, p: progressFor(item, progress) }))
      .filter(({ p }) => p.done < p.total)
      .map(({ item, p }) => ({ ...item, ...p, started: p.done > 0 }));
  }

  const prioritizedIds = new Set(prioritized.map((item) => item.id));
  const essential = library
    .filter((item) => !item.relevantWhen && !prioritizedIds.has(item.id))
    .map((item) => ({ ...item, ...progressFor(item, progress) }));

  const completedCount = library.filter((item) => {
    const p = progressFor(item, progress);
    return p.total > 0 && p.done === p.total;
  }).length;

  return { prioritized, essential, completedCount };
}

export type AdvicePrioritiesResult =
  | { ok: true; value: string[] }
  | { ok: false; error: string };

/** Every id must be a known library item; duplicates collapse to first occurrence. */
export function validateAdvicePriorities(input: unknown, library: AdviceItem[]): AdvicePrioritiesResult {
  if (!Array.isArray(input) || !input.every((v) => typeof v === "string")) {
    return { ok: false, error: "priorities must be an array of advice ids" };
  }
  const knownIds = new Set(library.map((item) => item.id));
  const deduped: string[] = [];
  for (const id of input as string[]) {
    if (!knownIds.has(id)) return { ok: false, error: `unknown advice id: ${id}` };
    if (!deduped.includes(id)) deduped.push(id);
  }
  return { ok: true, value: deduped };
}

export type EmploymentStatus = "employed" | "self_employed" | "unemployed" | "retired" | "student";
export type Homeownership = "own" | "rent" | "other";

export interface AdviceProfileAnswers {
  hasDependents?: boolean;
  employmentStatus?: EmploymentStatus;
  homeownership?: Homeownership;
}

const EMPLOYMENT_STATUSES: EmploymentStatus[] = ["employed", "self_employed", "unemployed", "retired", "student"];
const HOMEOWNERSHIP_VALUES: Homeownership[] = ["own", "rent", "other"];
const ADVICE_PROFILE_KEYS = new Set(["hasDependents", "employmentStatus", "homeownership"]);

export type AdviceProfileResult =
  | { ok: true; value: AdviceProfileAnswers | null }
  | { ok: false; error: string };

/**
 * Every field is optional (the plan requires explicit Skip for each
 * question) and `null` means "clear my saved answers", not "set every field
 * to its default". Unknown keys are rejected rather than silently dropped,
 * so a client bug surfaces immediately instead of writing partial garbage.
 */
export function validateAdviceProfile(input: unknown): AdviceProfileResult {
  if (input === null) return { ok: true, value: null };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "profile must be an object or null" };
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ADVICE_PROFILE_KEYS.has(key)) return { ok: false, error: `unknown profile field: ${key}` };
  }
  if (record.hasDependents !== undefined && typeof record.hasDependents !== "boolean") {
    return { ok: false, error: "hasDependents must be a boolean" };
  }
  if (
    record.employmentStatus !== undefined &&
    !EMPLOYMENT_STATUSES.includes(record.employmentStatus as EmploymentStatus)
  ) {
    return { ok: false, error: "employmentStatus is not a recognized value" };
  }
  if (
    record.homeownership !== undefined &&
    !HOMEOWNERSHIP_VALUES.includes(record.homeownership as Homeownership)
  ) {
    return { ok: false, error: "homeownership is not a recognized value" };
  }
  return { ok: true, value: record as AdviceProfileAnswers };
}

export interface AdviceLibraryViolation {
  itemId: string;
  reason: string;
}

const GUARANTEE_LANGUAGE = /\b(guarantee[ds]?|risk[- ]free|assured returns?|can't lose|will double|promise[ds]?)\b/i;

/**
 * Content-review guard, not a runtime check: run in a test so a future edit
 * to ADVICE_LIBRARY that adds a stale review date, a broken source, a
 * duplicate task id, or prohibited guarantee language fails CI before it
 * ships, rather than being caught by a human skim.
 */
export function validateAdviceLibrary(
  library: AdviceItem[],
  options: { asOf: string; maxReviewAgeDays: number },
): AdviceLibraryViolation[] {
  const violations: AdviceLibraryViolation[] = [];
  const asOfMs = new Date(`${options.asOf}T00:00:00Z`).getTime();

  for (const item of library) {
    if (item.sources.length === 0) {
      violations.push({ itemId: item.id, reason: "missing sources" });
    }

    const taskIds = new Set<string>();
    for (const task of item.tasks) {
      if (taskIds.has(task.id)) {
        violations.push({ itemId: item.id, reason: `duplicate task id: ${task.id}` });
      }
      taskIds.add(task.id);
    }

    if (GUARANTEE_LANGUAGE.test(item.title) || GUARANTEE_LANGUAGE.test(item.body)) {
      violations.push({ itemId: item.id, reason: "prohibited guarantee language" });
    }

    for (const source of item.sources) {
      const ageDays = (asOfMs - new Date(`${source.reviewedAt}T00:00:00Z`).getTime()) / 86_400_000;
      if (ageDays > options.maxReviewAgeDays) {
        violations.push({ itemId: item.id, reason: `stale source review: ${source.url}` });
      }

      let host: string | null = null;
      try {
        host = new URL(source.url).hostname.replace(/^www\./, "");
      } catch {
        violations.push({ itemId: item.id, reason: `unparseable source URL: ${source.url}` });
      }
      if (host && !ALLOWED_SOURCE_HOSTS.includes(host)) {
        violations.push({ itemId: item.id, reason: `unsupported external source: ${source.url}` });
      }
    }
  }

  return violations;
}
