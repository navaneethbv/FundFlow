/**
 * Phase 11: general financial education, not advice. Every item here is
 * original text written for FundFlow — none of it is copied from Monarch or
 * any other product — and every source is a neutral public resource (a
 * federal regulator or agency), never a specific fund, insurer, or broker.
 * This library is reviewed content, not user-generated: changing `body` or
 * `tasks` text is a deliberate edit, and `version` bumps whenever the
 * substance changes (see lib/advice.ts for what a version bump does to
 * existing users' progress).
 */

export type AdviceCategory = "save_up" | "spend" | "pay_down" | "protect" | "invest" | "wellness";

export interface AdviceSource {
  title: string;
  url: string;
  reviewedAt: string; // YYYY-MM-DD, last time a human confirmed this source still says this
}

export interface AdviceTask {
  id: string; // stable across content edits — reordering or rewording a task must not change its id
  label: string;
}

export interface AdviceContext {
  runwayMonths: number | null;
  hasBudget: boolean;
  hasGoals: boolean;
  creditCardCarry: boolean;
  hasInvestments: boolean;
}

export interface AdviceItem {
  id: string;
  version: number;
  category: AdviceCategory;
  title: string;
  body: string;
  tasks: AdviceTask[];
  sources: AdviceSource[];
  /** Absent means "always relevant" (shown in Essential, never auto-prioritized). */
  relevantWhen?: (ctx: AdviceContext) => boolean;
}

/**
 * Every source must resolve to one of these neutral, non-commercial
 * publishers — a security review guard (see advice-content-review.test.ts)
 * fails the build if a URL points anywhere else, so this list is the actual
 * enforcement point, not just documentation.
 */
export const ALLOWED_SOURCE_HOSTS = [
  "consumerfinance.gov",
  "investor.gov",
  "irs.gov",
  "ssa.gov",
  "fdic.gov",
  "usa.gov",
  "mymoney.gov",
];

type AdviceTaskInput = readonly [id: string, label: string];

function advice(input: {
  id: string;
  category: AdviceCategory;
  title: string;
  body: string;
  tasks: readonly AdviceTaskInput[];
  source: AdviceSource;
  relevantWhen?: (ctx: AdviceContext) => boolean;
}): AdviceItem {
  return {
    id: input.id,
    version: 1,
    category: input.category,
    title: input.title,
    body: input.body,
    tasks: input.tasks.map(([id, label]) => ({ id, label })),
    sources: [input.source],
    relevantWhen: input.relevantWhen,
  };
}

const CFPB_EARLY = {
  title: "Consumer Financial Protection Bureau — saving",
  url: "https://www.consumerfinance.gov",
  reviewedAt: "2026-02-10",
};
const CFPB_GOALS = {
  title: "Consumer Financial Protection Bureau — Your Money, Your Goals",
  url: "https://www.consumerfinance.gov",
  reviewedAt: "2026-02-10",
};
const CFPB_SPENDING = { ...CFPB_GOALS, reviewedAt: "2026-03-01" };
const CFPB_DEBT = {
  title: "Consumer Financial Protection Bureau — paying down debt",
  url: "https://www.consumerfinance.gov",
  reviewedAt: "2026-01-15",
};
const CFPB_MINIMUMS = {
  title: "Consumer Financial Protection Bureau — credit card minimum payments",
  url: "https://www.consumerfinance.gov",
  reviewedAt: "2026-01-15",
};

export const ADVICE_LIBRARY: AdviceItem[] = [
  advice({
    id: "emergency-fund",
    category: "save_up",
    title: "Build a starter emergency fund",
    body: "An emergency fund is money set aside for the unplanned: a job loss, a car repair, a medical bill. Most guidance starts with one month of essential expenses as a first milestone, then builds toward three to six months over time. Keep it somewhere you can reach in a day or two — a savings account, not an investment account — since the point is availability, not growth.",
    tasks: [["compare-savings-to-one-month", "Compare your current savings to one month of essential expenses"], ["open-dedicated-account", "Open a savings account used only for this fund"], ["automate-a-transfer", "Set up an automatic transfer into it on payday"]],
    source: CFPB_EARLY,
    relevantWhen: (ctx) => ctx.runwayMonths !== null && ctx.runwayMonths < 3,
  }),
  advice({
    id: "sinking-funds",
    category: "save_up",
    title: "Save ahead for expenses you can already see coming",
    body: "Not every large expense is an emergency — an annual insurance premium, a holiday season, a known car maintenance interval are all predictable. A sinking fund sets aside a little every month for a specific known cost, so paying it later doesn't compete with everyday spending or dip into the emergency fund.",
    tasks: [["list-known-future-costs", "List the irregular costs you already expect this year"], ["divide-into-monthly-amount", "Divide each one by the months until it's due"], ["create-a-goal-per-cost", "Create a savings goal for at least one of them"]],
    source: CFPB_GOALS,
    relevantWhen: (ctx) => !ctx.hasGoals,
  }),
  advice({
    id: "review-cash-flow",
    category: "spend",
    title: "Review where your money actually goes",
    body: "Most spending plans fail not because the plan was wrong, but because it was built on a guess instead of a look at real history. Reviewing a few months of actual transactions — not a memory of them — is usually the single most useful step before setting any spending limit.",
    tasks: [["review-three-months", "Look back at the last three months of spending by category"], ["identify-top-categories", "Identify your three largest discretionary categories"], ["set-one-limit", "Set a limit for just one of them to start"]],
    source: CFPB_SPENDING,
    relevantWhen: (ctx) => !ctx.hasBudget,
  }),
  advice({
    id: "cut-recurring-costs",
    category: "spend",
    title: "Audit your recurring subscriptions",
    body: "Recurring charges are easy to forget precisely because they don't require a decision each time. A periodic audit — once a quarter is plenty — catches subscriptions that quietly outlived their usefulness.",
    tasks: [["list-recurring-charges", "List every recurring charge you can find"], ["mark-unused", "Mark any you haven't used in the last two months"], ["cancel-one", "Cancel at least one"]],
    source: { ...CFPB_SPENDING, title: "Consumer Financial Protection Bureau — managing subscriptions" },
  }),
  advice({
    id: "high-interest-debt",
    category: "pay_down",
    title: "Tackle high-interest debt first",
    body: "Interest compounds, so a high-rate balance grows faster the longer it's carried. After covering minimums on everything, directing extra payments at the highest-rate balance first (sometimes called the avalanche method) minimizes total interest paid over time.",
    tasks: [["list-debts-by-rate", "List every balance and its interest rate"], ["confirm-minimums-covered", "Confirm every minimum payment is covered"], ["direct-extra-to-highest-rate", "Direct any extra payment at the highest-rate balance"]],
    source: CFPB_DEBT,
    relevantWhen: (ctx) => ctx.creditCardCarry,
  }),
  advice({
    id: "avoid-minimum-payments",
    category: "pay_down",
    title: "Understand what a minimum payment really costs",
    body: "A credit card's minimum payment is calculated to keep an account current, not to pay it off quickly — paying only the minimum on a revolving balance can mean paying far more in interest than the original charge, over a much longer time than it feels like.",
    tasks: [["check-statement-payoff-estimate", "Check your statement's payoff-time estimate at the minimum payment"], ["compare-to-a-fixed-higher-amount", "Compare it to paying a fixed, higher amount instead"]],
    source: CFPB_MINIMUMS,
  }),
  advice({
    id: "insurance-basics",
    category: "protect",
    title: "Check your basic insurance coverage",
    body: "Insurance exists to cover losses large enough to be genuinely disruptive — the goal is appropriate coverage for your situation, not the cheapest or most expensive policy available. This is general education, not a recommendation of any specific policy or insurer.",
    tasks: [["list-current-policies", "List your current health, auto, and renters/homeowners coverage"], ["check-coverage-gaps", "Note any obvious gaps (e.g. no renters insurance, no liability coverage)"]],
    source: { title: "USA.gov — insurance basics", url: "https://www.usa.gov", reviewedAt: "2026-04-05" },
  }),
  advice({
    id: "beneficiaries",
    category: "protect",
    title: "Keep beneficiaries up to date",
    body: "Retirement accounts, life insurance, and some bank accounts pass directly to their named beneficiary regardless of what a will says. Life changes — marriage, divorce, a new child — are the moments beneficiary designations are most likely to go stale.",
    tasks: [["list-accounts-with-beneficiaries", "List accounts that have a beneficiary designation"], ["confirm-each-is-current", "Confirm each one still reflects your current wishes"]],
    source: { title: "Social Security Administration — survivor benefits basics", url: "https://www.ssa.gov", reviewedAt: "2026-04-05" },
  }),
  advice({
    id: "get-started-investing",
    category: "invest",
    title: "Understand the basics before you invest",
    body: "Investing carries risk of loss, and past performance is not a reliable indicator of future results. General education — what a diversified fund is, how fees compound over decades, what your own time horizon means for risk — is worth having before choosing a specific account or product. This is not investment advice and does not recommend any specific security.",
    tasks: [["learn-key-terms", "Learn the difference between a stock, a bond, and a fund"], ["check-employer-match", "Check whether an employer retirement plan offers a matching contribution"]],
    source: { title: "Investor.gov — introduction to investing", url: "https://www.investor.gov", reviewedAt: "2026-05-01" },
    relevantWhen: (ctx) => !ctx.hasInvestments,
  }),
  advice({
    id: "diversification",
    category: "invest",
    title: "Learn why diversification matters",
    body: "Concentrating savings in a single stock or sector means a single bad outcome can be disproportionate. Diversification — spreading investments across many holdings — does not remove the possibility of loss, but it reduces the chance any one outcome dominates the result. This is general education, not a recommendation to buy or sell anything specific.",
    tasks: [["check-concentration", "Check what share of your investments sits in a single stock or sector"], ["learn-about-index-funds", "Learn what a broad-market index fund is"]],
    source: { title: "Investor.gov — diversification", url: "https://www.investor.gov", reviewedAt: "2026-05-01" },
    relevantWhen: (ctx) => ctx.hasInvestments,
  }),
  advice({
    id: "automate-good-habits",
    category: "wellness",
    title: "Automate the parts that are easy to forget",
    body: "Decisions made once — an automatic transfer on payday, an automatic bill payment — tend to stick far better than decisions that have to be remade every month. Automating the boring, recurring parts of a financial routine frees attention for the choices that actually need a decision.",
    tasks: [["automate-savings-transfer", "Automate at least one recurring savings transfer"], ["automate-a-bill", "Automate at least one recurring bill payment"]],
    source: { ...CFPB_GOALS, reviewedAt: "2026-06-01" },
  }),
  advice({
    id: "talk-about-money",
    category: "wellness",
    title: "Make money a regular conversation, not a once-a-year one",
    body: "Financial stress is often as much about uncertainty as about the numbers themselves. A short, regular check-in — with a partner, or just with yourself — tends to catch small problems before they become large ones, and makes shared decisions easier to reach.",
    tasks: [["schedule-a-money-checkin", "Schedule a recurring time to review finances"], ["share-one-goal", "Share one financial goal with someone you trust"]],
    source: { ...CFPB_GOALS, reviewedAt: "2026-06-01" },
  }),
];
