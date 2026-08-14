import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";
import {
  ALLOCATION_ERROR_MESSAGES,
  isLiabilityAccount,
  type AllocationError,
} from "@/lib/goals-v2";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Goal account allocations (Phase 7).
 *
 * Every write goes through the `set_goal_allocation` database function rather
 * than a direct insert. Two of its rules are cross-row — at most one goal may
 * claim an account's whole balance, and fixed allocations may not exceed the
 * balance — so they cannot be a CHECK constraint, and evaluating them in
 * application code would race: two concurrent requests each allocating half a
 * balance would both read "plenty left" and both succeed. The function takes a
 * row lock first.
 *
 * Audit metadata is ids and actions only, never goal names or amounts.
 */

const ALLOCATION_ERRORS = new Set<string>(Object.keys(ALLOCATION_ERROR_MESSAGES));

/** The function raises bare codes; surface the matching message verbatim. */
function allocationErrorFrom(message: string | undefined): AllocationError | null {
  if (!message) return null;
  for (const code of ALLOCATION_ERRORS) {
    if (message.includes(code)) return code as AllocationError;
  }
  return null;
}

function parseId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseAllocationRequest(body: Record<string, unknown> | null):
  | {
      ok: true;
      goalId: string;
      accountId: string;
      allocatedAmount: number | null;
      useEntireBalance: boolean;
    }
  | { ok: false; response: NextResponse } {
  const goalId = parseId(body?.goalId);
  const accountId = parseId(body?.accountId);
  if (!goalId) return { ok: false, response: badRequest("goalId is required") };
  if (!accountId) return { ok: false, response: badRequest("accountId is required") };
  const useEntireBalance = body?.useEntireBalance === true;
  let allocatedAmount: number | null = null;
  if (!useEntireBalance) {
    const raw = body?.allocatedAmount;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
      return {
        ok: false,
        response: badRequest(ALLOCATION_ERROR_MESSAGES.allocation_amount_required),
      };
    }
    allocatedAmount = Math.round(raw * 100) / 100;
  } else if (body?.allocatedAmount !== undefined && body.allocatedAmount !== null) {
    return {
      ok: false,
      response: badRequest(ALLOCATION_ERROR_MESSAGES.allocation_mode_conflict),
    };
  }
  return { ok: true, goalId, accountId, allocatedAmount, useEntireBalance };
}

async function captureBaseline(
  supabase: SupabaseClient,
  userId: string,
  goalId: string,
  goal: { goal_type: string; starting_balance: number | string | null; target_amount: number | string | null },
  account: { type: string | null; current_balance: number | string | null },
): Promise<boolean> {
  if (
    goal.goal_type !== "pay_down" ||
    goal.starting_balance !== null ||
    !isLiabilityAccount(account.type)
  ) {
    return false;
  }
  const startingBalance = Number(account.current_balance ?? 0);
  const targetBalance = Math.max(
    0,
    Math.round((startingBalance - Number(goal.target_amount ?? 0)) * 100) / 100,
  );
  const { error } = await supabase
    .from("goals")
    .update({
      starting_balance: startingBalance,
      target_balance: goal.target_amount ? targetBalance : 0,
    })
    .eq("id", goalId)
    .eq("user_id", userId)
    .is("starting_balance", null);
  if (error) throw error;
  return true;
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    if (!(await checkRateLimit(`goal-allocation:${user.id}`, 40, 60))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const parsed = parseAllocationRequest(body);
    if (!parsed.ok) return parsed.response;
    const { goalId, accountId, allocatedAmount, useEntireBalance } = parsed;

    // Ownership, not visibility: RLS also exposes a household member's shared
    // goals and accounts, and neither is writable by them. The database
    // function re-checks both, but failing here gives a 404 instead of a 500.
    const [{ data: goal }, { data: account }] = await Promise.all([
      supabase
        .from("goals")
        .select("id, goal_type, starting_balance, target_amount")
        .eq("id", goalId)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("accounts")
        .select("id, type, current_balance")
        .eq("id", accountId)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const { data: allocationId, error } = await supabase.rpc("set_goal_allocation", {
      p_goal_id: goalId,
      p_account_id: accountId,
      p_allocated_amount: allocatedAmount,
      p_use_entire_balance: useEntireBalance,
    });
    if (error) {
      const code = allocationErrorFrom(error.message);
      if (code) {
        return NextResponse.json(
          { error: ALLOCATION_ERROR_MESSAGES[code], code },
          { status: 409 },
        );
      }
      throw error;
    }

    // Capture the pay-down baseline exactly once, on the first liability link.
    // Recomputing it on a later sync would move the starting line and make
    // progress the user already earned disappear.
    const baselineCaptured = await captureBaseline(
      supabase,
      user.id,
      goalId,
      goal as { goal_type: string; starting_balance: number | string | null; target_amount: number | string | null },
      account as { type: string | null; current_balance: number | string | null },
    );

    await writeAudit({
      userId: user.id,
      action: "goal_allocation_set",
      metadata: { goal_id: goalId, account_id: accountId, baselineCaptured },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true, id: allocationId, baselineCaptured });
  } catch (error) {
    return errorResponse("goals.accounts.post", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const goalId = request.nextUrl.searchParams.get("goalId")?.trim();
    const accountId = request.nextUrl.searchParams.get("accountId")?.trim();
    if (!goalId || !accountId) {
      return badRequest("goalId and accountId are required");
    }

    const { data, error } = await supabase
      .from("goal_accounts")
      .delete()
      .eq("goal_id", goalId)
      .eq("account_id", accountId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Allocation not found" }, { status: 404 });
    }

    // `starting_balance` deliberately survives unlinking: it is the baseline the
    // goal's progress was measured from, and re-linking later must not silently
    // reset it to whatever the balance happens to be that day.
    await writeAudit({
      userId: user.id,
      action: "goal_allocation_removed",
      metadata: { goal_id: goalId, account_id: accountId },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("goals.accounts.delete", error);
  }
}
