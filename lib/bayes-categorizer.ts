export interface CategorizationRow {
  id: string;
  merchant: string | null;
  name: string | null;
  category: string | null;
}

export interface CategorySuggestion {
  transactionId: string;
  category: string;
  confidence: number;
  sampleSize: number;
}

export interface BayesTrainingResult {
  suggestions: CategorySuggestion[];
  eligible: boolean;
  reason?: "not_enough_rows" | "not_enough_categories";
}

const MAX_TRAINING_ROWS = 5_000;
const MIN_TRAINING_ROWS = 20;
const MIN_CONFIDENCE = 0.7;

function tokenize(row: Pick<CategorizationRow, "merchant" | "name">): string[] {
  return `${row.merchant ?? ""} ${row.name ?? ""}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2)
    .slice(0, 40);
}

export function trainLocalBayes(rows: readonly CategorizationRow[]): BayesTrainingResult {
  const labeled = rows.filter((row) => row.category?.trim()).slice(0, MAX_TRAINING_ROWS);
  const categories = [...new Set(labeled.map((row) => row.category!.trim()))];
  if (labeled.length < MIN_TRAINING_ROWS) return { suggestions: [], eligible: false, reason: "not_enough_rows" };
  if (categories.length < 2) return { suggestions: [], eligible: false, reason: "not_enough_categories" };

  const categoryCounts = new Map(categories.map((category) => [category, 0]));
  const tokenCounts = new Map<string, Map<string, number>>();
  const vocabulary = new Set<string>();
  for (const row of labeled) {
    const category = row.category!.trim();
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    const tokens = tokenize(row);
    const counts = tokenCounts.get(category) ?? new Map<string, number>();
    for (const token of tokens) {
      vocabulary.add(token);
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    tokenCounts.set(category, counts);
  }

  const suggestions: CategorySuggestion[] = [];
  for (const row of rows.filter((candidate) => !candidate.category).slice(0, MAX_TRAINING_ROWS)) {
    const tokens = tokenize(row);
    if (tokens.length === 0) continue;
    const scores = categories.map((category) => {
      const counts = tokenCounts.get(category)!;
      const prior = (categoryCounts.get(category)! + 1) / (labeled.length + categories.length);
      const denominator = categoryCounts.get(category)! + vocabulary.size;
      const logScore = tokens.reduce(
        (score, token) => score + Math.log(((counts.get(token) ?? 0) + 1) / denominator),
        Math.log(prior),
      );
      return { category, logScore };
    }).sort((left, right) => right.logScore - left.logScore);
    const best = scores[0];
    const runnerUp = scores[1];
    if (!best) continue;
    const confidence = runnerUp
      ? 1 / (1 + Math.exp(runnerUp.logScore - best.logScore))
      : 1;
    if (confidence >= MIN_CONFIDENCE) {
      suggestions.push({ transactionId: row.id, category: best.category, confidence, sampleSize: labeled.length });
    }
  }
  return { suggestions, eligible: true };
}

export const BAYES_LIMITS = {
  maxTrainingRows: MAX_TRAINING_ROWS,
  minTrainingRows: MIN_TRAINING_ROWS,
  minConfidence: MIN_CONFIDENCE,
} as const;
