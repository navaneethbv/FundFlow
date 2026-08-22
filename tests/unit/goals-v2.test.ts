import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  computeFundedGoals,
  goalContributionsForMonth,
  goalTargetAmount,
  validateAllocation,
  type AccountBalanceRow,
  type GoalAccountRow,
  type GoalProgressEventRow,
  type GoalV2Row,
} from "@/lib/goals-v2";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  GOAL_TEMPLATES,
  goalImageAlt,
  goalImageFor,
  isKnownGoalImageSlug,
} from "@/lib/goal-templates";

/**
 * Funding is the whole point of Phase 7: a goal's progress now comes from three
 * sources at once (typed-in manual progress, live account allocations, and a
 * dated event ledger), and the failure mode is silently counting the same money
 * twice. These tests pin each source separately and then together.
 */

const TODAY = new Date("2026-07-15T00:00:00Z");

function goal(partial: Partial<GoalV2Row> = {}): GoalV2Row {
  return {
    id: "g1",
    name: "Emergency fund",
    target_amount: 10_000,
    saved_amount: 0,
    target_date: null,
    household_id: null,
    goal_type: "save_up",
    image_slug: "emergency-fund",
    monthly_contribution: null,
    spending_reduces: false,
    starting_balance: null,
    target_balance: 10_000,
    ...partial,
  };
}

function account(partial: Partial<AccountBalanceRow> = {}): AccountBalanceRow {
  return {
    id: "acct-1",
    current_balance: 5_000,
    type: "depository",
    ...partial,
  };
}

function link(partial: Partial<GoalAccountRow> = {}): GoalAccountRow {
  return {
    goal_id: "g1",
    account_id: "acct-1",
    allocated_amount: 1_000,
    use_entire_balance: false,
    ...partial,
  };
}

function event(partial: Partial<GoalProgressEventRow> = {}): GoalProgressEventRow {
  return {
    goal_id: "g1",
    event_date: "2026-07-01",
    amount: 500,
    ...partial,
  };
}

function only(
  goals: GoalV2Row[],
  links: GoalAccountRow[] = [],
  accounts: AccountBalanceRow[] = [],
  events: GoalProgressEventRow[] = [],
  today = TODAY,
) {
  return computeFundedGoals(goals, links, accounts, events, today)[0]!;
}

describe("goalTargetAmount", () => {
  it("uses target_amount for a save-up goal", () => {
    expect(goalTargetAmount(goal({ target_amount: 7_500 }))).toBe(7_500);
  });

  it("honors the payoff amount the user entered for a pay-down goal", () => {
    // A user who asks to pay down 5,000 of a 12,000 loan gets a 5,000 target,
    // not the whole captured balance.
    expect(
      goalTargetAmount(
        goal({
          goal_type: "pay_down",
          target_amount: 5_000,
          starting_balance: 12_000,
          target_balance: 0,
        }),
      ),
    ).toBe(5_000);
  });

  it("uses the balance the pay-down goal has to close when no amount was entered", () => {
    expect(
      goalTargetAmount(
        goal({
          goal_type: "pay_down",
          target_amount: 0,
          starting_balance: 4_000,
          target_balance: 0,
        }),
      ),
    ).toBe(4_000);
  });

  it("respects a non-zero pay-down target balance", () => {
    expect(
      goalTargetAmount(
        goal({
          goal_type: "pay_down",
          target_amount: 0,
          starting_balance: 4_000,
          target_balance: 1_000,
        }),
      ),
    ).toBe(3_000);
  });

  it("never returns a negative target", () => {
    expect(
      goalTargetAmount(
        goal({
          goal_type: "pay_down",
          target_amount: 0,
          starting_balance: 500,
          target_balance: 900,
        }),
      ),
    ).toBe(0);
  });

  it("treats a pay-down goal with no entered amount and no baseline as having nothing to close", () => {
    expect(
      goalTargetAmount(
        goal({ goal_type: "pay_down", target_amount: 0, starting_balance: null }),
      ),
    ).toBe(0);
  });

  it("does not complete a pay-down goal that has a target but no linked baseline", () => {
    const funded = only([
      goal({ goal_type: "pay_down", target_amount: 5_000, starting_balance: null }),
    ]);
    expect(funded.target_amount).toBe(5_000);
    expect(funded.remainingAmount).toBe(5_000);
    expect(funded.badge).toBe("on-track");
  });
});

describe("computeFundedGoals funding sources", () => {
  it("counts hand-entered manual progress", () => {
    const funded = only([goal({ saved_amount: 2_500 })]);
    expect(funded.funded_amount).toBe(2_500);
    expect(funded.progressPct).toBe(25);
    expect(funded.remainingAmount).toBe(7_500);
  });

  it("counts a fixed account allocation", () => {
    const funded = only([goal()], [link({ allocated_amount: 1_500 })], [account()]);
    expect(funded.allocatedFromAccounts).toBe(1_500);
    expect(funded.funded_amount).toBe(1_500);
  });

  it("caps a fixed allocation at the account's actual balance", () => {
    // The balance dropped below what was allocated; funding must follow the
    // money, not the stale intention.
    const funded = only(
      [goal()],
      [link({ allocated_amount: 4_000 })],
      [account({ current_balance: 900 })],
    );
    expect(funded.allocatedFromAccounts).toBe(900);
  });

  it("counts the whole balance for an entire-balance claim", () => {
    const funded = only(
      [goal()],
      [link({ allocated_amount: null, use_entire_balance: true })],
      [account({ current_balance: 3_200 })],
    );
    expect(funded.allocatedFromAccounts).toBe(3_200);
  });

  it("treats a negative or missing balance as contributing nothing", () => {
    expect(
      only(
        [goal()],
        [link({ allocated_amount: null, use_entire_balance: true })],
        [account({ current_balance: -50 })],
      ).allocatedFromAccounts,
    ).toBe(0);
    expect(
      only([goal()], [link()], [account({ current_balance: null })])
        .allocatedFromAccounts,
    ).toBe(0);
  });

  it("ignores an allocation whose account is not in the balance set", () => {
    const funded = only([goal()], [link({ account_id: "ghost" })], [account()]);
    expect(funded.allocatedFromAccounts).toBe(0);
  });

  it("counts the event ledger, including negative events", () => {
    const funded = only(
      [goal()],
      [],
      [],
      [event({ amount: 800 }), event({ amount: -200, event_date: "2026-07-05" })],
    );
    expect(funded.eventTotal).toBe(600);
    expect(funded.funded_amount).toBe(600);
  });

  it("adds manual progress, allocations, and events together", () => {
    const funded = only(
      [goal({ saved_amount: 1_000 })],
      [link({ allocated_amount: 2_000 })],
      [account({ current_balance: 9_000 })],
      [event({ amount: 500 })],
    );
    expect(funded.funded_amount).toBe(3_500);
  });

  it("does not double count the same account linked twice", () => {
    // The database's unique (goal_id, account_id) makes this unreachable, but a
    // duplicated row must not inflate funding if it ever does appear.
    const funded = only(
      [goal()],
      [link({ allocated_amount: 1_000 }), link({ allocated_amount: 1_000 })],
      [account()],
    );
    expect(funded.allocatedFromAccounts).toBe(1_000);
  });

  it("keeps each goal's allocations and events to itself", () => {
    const result = computeFundedGoals(
      [goal({ id: "g1" }), goal({ id: "g2", name: "Car" })],
      [
        link({ goal_id: "g1", account_id: "acct-1", allocated_amount: 1_000 }),
        link({ goal_id: "g2", account_id: "acct-2", allocated_amount: 2_000 }),
      ],
      [account({ id: "acct-1" }), account({ id: "acct-2" })],
      [event({ goal_id: "g2", amount: 700 })],
      TODAY,
    );
    const byId = new Map(result.map((row) => [row.id, row]));
    expect(byId.get("g1")!.funded_amount).toBe(1_000);
    expect(byId.get("g2")!.funded_amount).toBe(2_700);
  });

  it("lets one account fund two goals independently", () => {
    // The allocation RPC stops the totals exceeding the balance; the projection
    // just reports what each goal claims.
    const result = computeFundedGoals(
      [goal({ id: "g1" }), goal({ id: "g2" })],
      [
        link({ goal_id: "g1", allocated_amount: 1_000 }),
        link({ goal_id: "g2", allocated_amount: 1_500 }),
      ],
      [account({ current_balance: 5_000 })],
      [],
      TODAY,
    );
    expect(result[0]!.allocatedFromAccounts).toBe(1_000);
    expect(result[1]!.allocatedFromAccounts).toBe(1_500);
  });
});

describe("computeFundedGoals pay-down goals", () => {
  const payDown = goal({
    goal_type: "pay_down",
    starting_balance: 6_000,
    target_balance: 0,
    target_amount: 6_000,
  });

  it("measures progress as the balance closed since the baseline", () => {
    const funded = only(
      [payDown],
      [link({ allocated_amount: null, use_entire_balance: true })],
      [account({ current_balance: 2_500, type: "credit" })],
    );
    expect(funded.funded_amount).toBe(3_500);
    expect(funded.progressPct).toBe(58);
  });

  it("does not add manual progress or events on top of the balance delta", () => {
    // Pay-down has exactly one definition of progress. Adding the ledger too
    // would count the same payment twice: it both moved the balance and could
    // have been recorded as an event.
    const funded = only(
      [{ ...payDown, saved_amount: 1_000 }],
      [link({ allocated_amount: null, use_entire_balance: true })],
      [account({ current_balance: 2_500, type: "credit" })],
      [event({ amount: 900 })],
    );
    expect(funded.funded_amount).toBe(3_500);
  });

  it("reports no progress when the balance grew past the baseline", () => {
    const funded = only(
      [payDown],
      [link({ allocated_amount: null, use_entire_balance: true })],
      [account({ current_balance: 7_200, type: "credit" })],
    );
    expect(funded.funded_amount).toBe(0);
    expect(funded.progressPct).toBe(0);
  });

  it("completes once the balance reaches the target", () => {
    const funded = only(
      [payDown],
      [link({ allocated_amount: null, use_entire_balance: true })],
      [account({ current_balance: 0, type: "credit" })],
    );
    expect(funded.funded_amount).toBe(6_000);
    expect(funded.badge).toBe("completed");
  });

  it("reports nothing rather than NaN with no linked account", () => {
    const funded = only([payDown], [], []);
    expect(funded.funded_amount).toBe(0);
    expect(Number.isFinite(funded.progressPct)).toBe(true);
  });

  it("sums across several linked liability accounts", () => {
    const funded = only(
      [{ ...payDown, starting_balance: 10_000, target_balance: 0, target_amount: 10_000 }],
      [
        link({ account_id: "acct-1", allocated_amount: null, use_entire_balance: true }),
        link({ account_id: "acct-2", allocated_amount: null, use_entire_balance: true }),
      ],
      [
        account({ id: "acct-1", current_balance: 3_000, type: "credit" }),
        account({ id: "acct-2", current_balance: 1_000, type: "loan" }),
      ],
    );
    expect(funded.funded_amount).toBe(6_000);
  });
});

describe("computeFundedGoals est_monthly", () => {
  it("is null without a target date", () => {
    expect(only([goal({ target_date: null })]).est_monthly).toBeNull();
  });

  it("divides what remains across the months left", () => {
    const funded = only([goal({ saved_amount: 4_000, target_date: "2026-10-15" })]);
    // 6,000 remaining over 3 months.
    expect(funded.est_monthly).toBe(2_000);
  });

  it("asks for the whole remainder when the date has already passed", () => {
    const funded = only([goal({ saved_amount: 1_000, target_date: "2026-01-01" })]);
    expect(funded.est_monthly).toBe(9_000);
  });

  it("is zero once the goal is funded", () => {
    const funded = only([goal({ saved_amount: 10_000, target_date: "2026-10-15" })]);
    expect(funded.est_monthly).toBe(0);
  });
});

describe("computeFundedGoals badges", () => {
  it("completed once nothing remains", () => {
    expect(only([goal({ saved_amount: 10_000 })]).badge).toBe("completed");
  });

  it("completed for a degenerate zero target rather than dividing by zero", () => {
    const funded = only([goal({ target_amount: 0, target_balance: 0 })]);
    expect(funded.badge).toBe("completed");
    expect(funded.progressPct).toBe(100);
    expect(funded.remainingAmount).toBe(0);
  });

  it("behind when the target date has passed with money still owed", () => {
    expect(only([goal({ target_date: "2026-01-01" })]).badge).toBe("behind");
  });

  it("behind beats at-risk: a missed date is not a pace problem", () => {
    const funded = only(
      [goal({ target_date: "2026-01-01", monthly_contribution: 1 })],
      [],
      [],
      [],
    );
    expect(funded.badge).toBe("behind");
  });

  it("on-track for a goal with no date and no plan yet", () => {
    expect(only([goal()]).badge).toBe("on-track");
  });

  it("on-track when there is no pace evidence to judge", () => {
    // A goal created moments ago has no ledger and no plan; nagging before any
    // month has elapsed would be noise, not information.
    expect(only([goal({ target_date: "2026-12-31" })]).badge).toBe("on-track");
  });

  it("at-risk when the planned contribution cannot reach the date", () => {
    const funded = only([
      goal({ target_date: "2026-10-15", monthly_contribution: 500 }),
    ]);
    // 10,000 over 3 months needs ~3,333/mo.
    expect(funded.est_monthly).toBe(3_333.33);
    expect(funded.badge).toBe("at-risk");
  });

  it("on-track when the planned contribution covers the required pace", () => {
    expect(
      only([goal({ target_date: "2026-10-15", monthly_contribution: 4_000 })]).badge,
    ).toBe("on-track");
  });

  it("prefers the actual ledger pace over the plan once events exist", () => {
    const generousPlan = goal({
      target_date: "2026-10-15",
      monthly_contribution: 5_000,
    });
    // Planned 5,000/mo but only 300 actually landed over the trailing window.
    const funded = only([generousPlan], [], [], [event({ amount: 300 })]);
    expect(funded.badge).toBe("at-risk");
    expect(funded.trailingMonthlyPace).toBeLessThan(500);
  });

  it("on-track when the ledger pace keeps up", () => {
    const funded = only(
      // Target set well above the contributions so the goal is still open —
      // otherwise it completes and the badge never reaches the pace check.
      [
        goal({
          target_amount: 20_000,
          target_balance: 20_000,
          target_date: "2026-10-15",
          monthly_contribution: 100,
        }),
      ],
      [],
      [],
      [
        event({ amount: 4_000, event_date: "2026-05-10" }),
        event({ amount: 4_000, event_date: "2026-06-10" }),
        event({ amount: 4_000, event_date: "2026-07-10" }),
      ],
    );
    expect(funded.trailingMonthlyPace).toBe(4_000);
    expect(funded.badge).toBe("on-track");
  });

  it("ignores events outside the trailing window when pacing", () => {
    const funded = only(
      [goal({ target_date: "2026-10-15", monthly_contribution: 100 })],
      [],
      [],
      [event({ amount: 9_000, event_date: "2025-01-01" })],
    );
    // The old contribution still counts as funding...
    expect(funded.funded_amount).toBe(9_000);
    // ...but it is not evidence of a current pace.
    expect(funded.trailingMonthlyPace).toBe(0);
  });
});

describe("computeFundedGoals ordering and shape", () => {
  it("sorts unfinished goals before completed ones", () => {
    const result = computeFundedGoals(
      [
        goal({ id: "done", name: "Done", saved_amount: 10_000 }),
        goal({ id: "open", name: "Open" }),
      ],
      [],
      [],
      [],
      TODAY,
    );
    expect(result.map((row) => row.id)).toEqual(["open", "done"]);
  });

  it("sorts by soonest target date, then by name", () => {
    const result = computeFundedGoals(
      [
        goal({ id: "c", name: "C", target_date: null }),
        goal({ id: "b", name: "B", target_date: "2026-12-01" }),
        goal({ id: "a", name: "A", target_date: "2026-08-01" }),
      ],
      [],
      [],
      [],
      TODAY,
    );
    expect(result.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list for no goals", () => {
    expect(computeFundedGoals([], [], [], [], TODAY)).toEqual([]);
  });

  it("rounds money to cents and never emits NaN", () => {
    const funded = only(
      [goal({ target_amount: 3, saved_amount: 0, target_date: "2026-09-15" })],
      [],
      [],
      [event({ amount: 0.005 })],
    );
    expect(Number.isNaN(funded.funded_amount)).toBe(false);
    expect(funded.est_monthly).toBe(1.5);
  });
});

describe("validateAllocation", () => {
  it("accepts a fixed allocation within the balance", () => {
    expect(
      validateAllocation({
        existing: [],
        accountBalance: 1_000,
        allocatedAmount: 400,
        useEntireBalance: false,
      }),
    ).toBeNull();
  });

  it("accepts an entire-balance claim on an unclaimed account", () => {
    expect(
      validateAllocation({
        existing: [],
        accountBalance: 1_000,
        allocatedAmount: null,
        useEntireBalance: true,
      }),
    ).toBeNull();
  });

  it("rejects an amount alongside an entire-balance claim", () => {
    expect(
      validateAllocation({
        existing: [],
        accountBalance: 1_000,
        allocatedAmount: 100,
        useEntireBalance: true,
      }),
    ).toBe("allocation_mode_conflict");
  });

  it("rejects a missing or non-positive fixed amount", () => {
    for (const allocatedAmount of [null, 0, -5]) {
      expect(
        validateAllocation({
          existing: [],
          accountBalance: 1_000,
          allocatedAmount,
          useEntireBalance: false,
        }),
      ).toBe("allocation_amount_required");
    }
  });

  it("rejects a second entire-balance claim on the same account", () => {
    expect(
      validateAllocation({
        existing: [link({ goal_id: "other", allocated_amount: null, use_entire_balance: true })],
        accountBalance: 1_000,
        allocatedAmount: 100,
        useEntireBalance: false,
      }),
    ).toBe("account_already_fully_allocated");
  });

  it("rejects claiming the whole balance when fixed allocations exist", () => {
    expect(
      validateAllocation({
        existing: [link({ goal_id: "other", allocated_amount: 100 })],
        accountBalance: 1_000,
        allocatedAmount: null,
        useEntireBalance: true,
      }),
    ).toBe("account_has_fixed_allocations");
  });

  it("rejects fixed allocations that together exceed the balance", () => {
    expect(
      validateAllocation({
        existing: [link({ goal_id: "other", allocated_amount: 700 })],
        accountBalance: 1_000,
        allocatedAmount: 400,
        useEntireBalance: false,
      }),
    ).toBe("allocation_exceeds_balance");
  });

  it("allows fixed allocations that exactly fill the balance", () => {
    expect(
      validateAllocation({
        existing: [link({ goal_id: "other", allocated_amount: 600 })],
        accountBalance: 1_000,
        allocatedAmount: 400,
        useEntireBalance: false,
      }),
    ).toBeNull();
  });

  it("treats a null or negative balance as nothing to allocate", () => {
    expect(
      validateAllocation({
        existing: [],
        accountBalance: null,
        allocatedAmount: 10,
        useEntireBalance: false,
      }),
    ).toBe("allocation_exceeds_balance");
    expect(
      validateAllocation({
        existing: [],
        accountBalance: -100,
        allocatedAmount: 10,
        useEntireBalance: false,
      }),
    ).toBe("allocation_exceeds_balance");
  });
});

describe("goal templates", () => {
  it("ships exactly the eight templates the wizard offers, each with an asset", () => {
    expect(GOAL_TEMPLATES).toHaveLength(8);
    for (const template of GOAL_TEMPLATES) {
      expect(existsSync(`public/goals/${template.slug}.svg`)).toBe(true);
      expect(template.label.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      // Alt text is the only description a screen reader gets for the card art.
      expect(template.alt.length).toBeGreaterThan(0);
    }
  });

  it("has unique slugs", () => {
    const slugs = GOAL_TEMPLATES.map((template) => template.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("resolves a known slug to its bundled asset", () => {
    expect(goalImageFor("car")).toBe("/goals/car.svg");
    expect(goalImageAlt("car")).toContain("car");
  });

  it("refuses to build a path from an unknown or hostile slug", () => {
    // image_slug is a database string; interpolating it blindly would let a
    // crafted value walk out of public/goals/.
    expect(goalImageFor("../../../etc/passwd")).toBeNull();
    expect(goalImageFor("does-not-exist")).toBeNull();
    expect(goalImageFor(null)).toBeNull();
    expect(goalImageAlt("../../secret")).toBe("");
  });

  it("only accepts a known slug for storage", () => {
    expect(isKnownGoalImageSlug("vacation")).toBe(true);
    expect(isKnownGoalImageSlug("vacation.svg")).toBe(false);
    expect(isKnownGoalImageSlug(42)).toBe(false);
    expect(isKnownGoalImageSlug(null)).toBe(false);
  });

  it("every shipped asset is referenced by a template", () => {
    const files = readdirSync("public/goals").filter((name) => name.endsWith(".svg"));
    const slugs = new Set(GOAL_TEMPLATES.map((template) => template.slug));
    for (const file of files) {
      expect(slugs.has(file.replace(/\.svg$/, ""))).toBe(true);
    }
  });

  it("keeps the illustrations free of external references", () => {
    // An <img src> to another origin would be blocked by the CSP's img-src
    // 'self', so a remote reference would silently render nothing.
    for (const template of GOAL_TEMPLATES) {
      const svg = readFileSync(`public/goals/${template.slug}.svg`, "utf8");
      // The xmlns declaration is a namespace identifier, not a fetch, so only
      // actual reference attributes are checked.
      expect(svg).not.toMatch(/(?:href|src)\s*=\s*["']https?:/i);
      expect(svg).not.toMatch(/url\(\s*["']?https?:/i);
      expect(svg).not.toContain("<script");
      expect(svg).not.toContain("<image");
    }
  });
});

describe("goalContributionsForMonth", () => {
  const goals = [
    { id: "g1", name: "Emergency fund", monthly_contribution: 500 },
    { id: "g2", name: "Vacation", monthly_contribution: 200 },
    { id: "g3", name: "Someday", monthly_contribution: null },
  ];

  it("pairs the planned contribution with what the ledger recorded", () => {
    const lines = goalContributionsForMonth(
      goals,
      [
        { goal_id: "g1", event_date: "2026-07-04", amount: 300 },
        { goal_id: "g1", event_date: "2026-07-20", amount: 150 },
      ],
      "2026-07",
    );
    const emergency = lines.find((line) => line.goalId === "g1")!;
    expect(emergency.planned).toBe(500);
    expect(emergency.actual).toBe(450);
  });

  it("ignores events from other months", () => {
    const lines = goalContributionsForMonth(
      goals,
      [
        { goal_id: "g1", event_date: "2026-06-30", amount: 900 },
        { goal_id: "g1", event_date: "2026-08-01", amount: 900 },
      ],
      "2026-07",
    );
    expect(lines.find((line) => line.goalId === "g1")!.actual).toBe(0);
  });

  it("nets a withdrawal against the month's contributions", () => {
    const lines = goalContributionsForMonth(
      goals,
      [
        { goal_id: "g2", event_date: "2026-07-04", amount: 400 },
        { goal_id: "g2", event_date: "2026-07-18", amount: -150 },
      ],
      "2026-07",
    );
    expect(lines.find((line) => line.goalId === "g2")!.actual).toBe(250);
  });

  it("omits a goal with neither a plan nor activity", () => {
    const lines = goalContributionsForMonth(goals, [], "2026-07");
    expect(lines.map((line) => line.goalId)).toEqual(["g1", "g2"]);
  });

  it("includes an unplanned goal once something is actually contributed", () => {
    const lines = goalContributionsForMonth(
      goals,
      [{ goal_id: "g3", event_date: "2026-07-09", amount: 75 }],
      "2026-07",
    );
    expect(lines.find((line) => line.goalId === "g3")).toMatchObject({
      planned: 0,
      actual: 75,
    });
  });

  it("orders by planned amount, then name", () => {
    expect(
      goalContributionsForMonth(goals, [], "2026-07").map((line) => line.name),
    ).toEqual(["Emergency fund", "Vacation"]);
  });

  it("returns nothing when there are no goals", () => {
    expect(goalContributionsForMonth([], [], "2026-07")).toEqual([]);
  });
});

describe("goalsV2 rollout flag", () => {
  it("ships now that the goals_v2 migration is applied", () => {
    // /goals and /budget are already-released pages that read goal_accounts
    // and goal_progress_events with this on, so the migration has to land
    // before the default does — it has.
    expect(isFeatureEnabled("goalsV2", { FUNDFLOW_FEATURE_FLAGS: "" })).toBe(true);
    expect(
      isFeatureEnabled("goalsV2", { FUNDFLOW_FEATURE_FLAGS: "goalsV2" }),
    ).toBe(true);
  });

  it("does not depend on the Phase 6 reports flag being named", () => {
    expect(
      isFeatureEnabled("goalsV2", { FUNDFLOW_FEATURE_FLAGS: "reportsPage" }),
    ).toBe(true);
  });

  it("sorts goals with target_date after goals without target_date", () => {
    const goalsList = [
      goal({ id: "g-nodate", name: "No Date Goal", target_date: null }),
      goal({ id: "g-withdate", name: "With Date Goal", target_date: "2026-12-31" }),
    ];
    const sorted = computeFundedGoals(
      goalsList,
      [],
      [],
      [],
      TODAY,
    );
    expect(sorted[0]!.id).toBe("g-withdate");
    expect(sorted[1]!.id).toBe("g-nodate");
  });

  it("handles null allocated_amount in existing allocations and debt starting_balance null", () => {
    const err = validateAllocation({
      existing: [
        { goal_id: "other", account_id: "acct-1", allocated_amount: null, use_entire_balance: false },
      ],
      accountBalance: 1000,
      allocatedAmount: 200,
      useEntireBalance: false,
    });
    expect(err).toBeNull();

    // Debt goal with starting_balance: null and linked account
    const debtGoalNoStart = goal({
      id: "g-debt-null-start",
      goal_type: "pay_down",
      starting_balance: null,
      target_balance: 0,
      target_amount: 5000,
    });
    const debtLink = link({ goal_id: "g-debt-null-start", account_id: "acct-debt" });
    const debtAcct = account({ id: "acct-debt", current_balance: 1000, type: "credit" });
    const fundedDebt = computeFundedGoals([debtGoalNoStart], [debtLink], [debtAcct], [], TODAY);
    expect(fundedDebt[0]!.funded_amount).toBe(0);
  });
});
